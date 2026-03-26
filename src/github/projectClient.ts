import * as vscode from 'vscode';

export type ProjectTarget =
  | { type: 'org'; owner: string; projectNumber: number }
  | { type: 'user'; owner: string; projectNumber: number };

export type KanbanCard = {
  itemId: string;
  title: string;
  contentType: 'Issue' | 'PullRequest' | 'DraftIssue' | 'Unknown';
  url?: string;
  statusOptionId: string | null;
  statusName: string | null;
};

export type KanbanColumn = {
  optionId: string;
  name: string;
};

export type KanbanBoard = {
  projectId: string;
  title: string;
  statusFieldId: string;
  columns: KanbanColumn[];
  cards: KanbanCard[];
};

export type RepositoryProject = {
  title: string;
  number: number;
  url: string;
};

type GraphQlError = { message?: string };

export function parseProjectTarget(urlStr: string): ProjectTarget | undefined {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return undefined;
  }

  const orgMatch = /^\/orgs\/([^/]+)\/projects\/(\d+)/.exec(parsed.pathname);
  if (orgMatch) {
    return { type: 'org', owner: orgMatch[1], projectNumber: Number(orgMatch[2]) };
  }

  const userMatch = /^\/users\/([^/]+)\/projects\/(\d+)/.exec(parsed.pathname);
  if (userMatch) {
    return { type: 'user', owner: userMatch[1], projectNumber: Number(userMatch[2]) };
  }

  return undefined;
}

export async function loadKanbanBoard(
  target: ProjectTarget,
  accessToken: string
): Promise<KanbanBoard> {
  const query = `
    query($owner: String!, $number: Int!) {
      ${target.type === 'org' ? 'organization' : 'user'}(login: $owner) {
        projectV2(number: $number) {
          id
          title
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 100) {
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  title
                  url
                }
                ... on PullRequest {
                  title
                  url
                }
                ... on DraftIssue {
                  title
                }
              }
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                }
              }
            }
          }
        }
      }
    }
  `;

  const payload = await callGraphQl<{
    organization?: GraphQlProjectContainer | null;
    user?: GraphQlProjectContainer | null;
  }>(accessToken, query, { owner: target.owner, number: target.projectNumber });

  const container = target.type === 'org' ? payload.organization : payload.user;
  const project = container?.projectV2;
  if (!project) {
    throw new Error('Project not found or inaccessible with your current GitHub session.');
  }

  const statusField = project.fields.nodes.find((field) => field.name === 'Status');
  if (!statusField) {
    throw new Error('This project has no Status field. A Kanban view requires a Status single-select field.');
  }

  const cards: KanbanCard[] = project.items.nodes.map((item) => {
    const content = item.content;
    const contentType = content?.__typename ?? 'Unknown';
    const title = content?.title ?? '(Untitled)';
    const url = 'url' in (content ?? {}) ? content?.url : undefined;

    return {
      itemId: item.id,
      title,
      contentType,
      url,
      statusOptionId: item.fieldValueByName?.optionId ?? null,
      statusName: item.fieldValueByName?.name ?? null,
    };
  });

  return {
    projectId: project.id,
    title: project.title,
    statusFieldId: statusField.id,
    columns: statusField.options.map((opt) => ({ optionId: opt.id, name: opt.name })),
    cards,
  };
}

export async function moveCardStatus(
  accessToken: string,
  input: {
    projectId: string;
    itemId: string;
    statusFieldId: string;
    targetOptionId: string;
  }
): Promise<void> {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await callGraphQl(
    accessToken,
    mutation,
    {
      projectId: input.projectId,
      itemId: input.itemId,
      fieldId: input.statusFieldId,
      optionId: input.targetOptionId,
    }
  );
}

async function callGraphQl<TData>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<TData> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'vscode-github-kanban-viewer',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401) {
    throw new Error('GitHub session is unauthorized. Please sign in again.');
  }
  if (response.status === 403) {
    throw new Error('GitHub session lacks permissions. Ensure requested scopes include project/repo.');
  }
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}).`);
  }

  const payload = (await response.json()) as { data?: TData; errors?: GraphQlError[] };
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? 'Unknown GitHub GraphQL error.');
  }
  if (!payload.data) {
    throw new Error('GitHub GraphQL returned no data.');
  }
  return payload.data;
}

type GraphQlProjectContainer = {
  projectV2: {
    id: string;
    title: string;
    fields: {
      nodes: Array<{
        id: string;
        name: string;
        options: Array<{ id: string; name: string }>;
      }>;
    };
    items: {
      nodes: Array<{
        id: string;
        content: { __typename: KanbanCard['contentType']; title?: string; url?: string } | null;
        fieldValueByName: { name: string; optionId: string } | null;
      }>;
    };
  } | null;
};

export function validateKanbanUrl(urlStr: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only http/https URLs are supported.' };
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return { ok: false, reason: 'Only github.com is supported in this version.' };
  }
  if (!/\/projects\/\d+/.test(parsed.pathname)) {
    return { ok: false, reason: 'URL must include /projects/<id>.' };
  }
  return { ok: true };
}

export async function getRequiredGitHubSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
  return vscode.authentication.getSession('github', scopes, { createIfNone: true });
}

export function parseGitHubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | undefined {
  const trimmed = remoteUrl.trim();

  // https://github.com/owner/repo(.git)
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // git@github.com:owner/repo(.git)
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return undefined;
}

export async function listRepositoryProjects(
  accessToken: string,
  owner: string,
  repo: string
): Promise<RepositoryProject[]> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        owner {
          __typename
          login
        }
        projectsV2(first: 20) {
          nodes {
            title
            number
          }
        }
      }
    }
  `;

  const payload = await callGraphQl<{
    repository: {
      owner: { __typename: 'Organization' | 'User'; login: string };
      projectsV2: { nodes: Array<{ title: string; number: number }> };
    } | null;
  }>(accessToken, query, { owner, name: repo });

  if (!payload.repository) {
    return [];
  }

  const ownerType = payload.repository.owner.__typename;
  const ownerLogin = payload.repository.owner.login;
  const basePath = ownerType === 'Organization' ? `orgs/${ownerLogin}` : `users/${ownerLogin}`;

  return payload.repository.projectsV2.nodes.map((project) => ({
    title: project.title,
    number: project.number,
    url: `https://github.com/${basePath}/projects/${project.number}`,
  }));
}

