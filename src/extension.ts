import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getRequiredGitHubSession,
  listRepositoryProjects,
  loadKanbanBoard,
  moveCardStatus,
  parseGitHubRemoteUrl,
  parseProjectTarget,
  validateKanbanUrl,
  KanbanBoard,
} from './github/projectClient';
import { KanbanPanel, WebviewInboundMessage } from './webview/kanbanPanel';

const CONFIG_SECTION = 'githubKanban';
const CONFIG_URL_PATH = `${CONFIG_SECTION}.url`;
const GITHUB_SCOPES = ['repo', 'project'];
const execFileAsync = promisify(execFile);

function getConfiguredUrl(): string | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const url = config.get<string>('url');
  const trimmed = (url ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function getWorkspaceOriginRemote(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync('git', ['-C', folder.uri.fsPath, 'remote', 'get-url', 'origin']);
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function detectProjectUrlFromWorkspace(accessToken: string): Promise<string | undefined> {
  const remote = await getWorkspaceOriginRemote();
  if (!remote) {
    return undefined;
  }

  const repo = parseGitHubRemoteUrl(remote);
  if (!repo) {
    return undefined;
  }

  const projects = await listRepositoryProjects(accessToken, repo.owner, repo.repo);
  if (projects.length === 0) {
    return undefined;
  }
  if (projects.length === 1) {
    return projects[0].url;
  }

  const picked = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.title,
      description: `#${project.number}`,
      detail: project.url,
      url: project.url,
    })),
    { placeHolder: 'Select a GitHub Project from this workspace repository' }
  );

  return picked?.url;
}

export function activate(context: vscode.ExtensionContext) {
  let panel: KanbanPanel | undefined;
  let currentBoard: KanbanBoard | undefined;
  let accessToken = '';

  const refreshBoard = async (urlStr: string): Promise<void> => {
    if (!panel) {
      return;
    }
    panel.postMessage({ type: 'loading', message: 'Loading board...' });
    const target = parseProjectTarget(urlStr);
    if (!target) {
      throw new Error('Could not parse a valid project target from the configured URL.');
    }
    currentBoard = await loadKanbanBoard(target, accessToken);
    panel.setTitle(`GitHub Kanban - ${currentBoard.title}`);
    panel.postMessage({ type: 'boardData', board: currentBoard });
  };

  const handleMessage = async (urlStr: string, message: WebviewInboundMessage): Promise<void> => {
    if (!panel) {
      return;
    }
    try {
      if (message.type === 'refreshRequested') {
        await refreshBoard(urlStr);
        return;
      }
      if (message.type === 'moveCard') {
        if (!currentBoard) {
          throw new Error('Board is not loaded yet.');
        }
        void moveCardStatus(accessToken, {
          projectId: currentBoard.projectId,
          itemId: message.itemId,
          statusFieldId: currentBoard.statusFieldId,
          targetOptionId: message.targetOptionId,
        }).then(() => {
          if (!panel) {
            return;
          }
          panel.postMessage({ type: 'moveSucceeded', itemId: message.itemId, targetOptionId: message.targetOptionId });
        }).catch((err) => {
          if (!panel) {
            return;
          }
          const errorText = err instanceof Error ? err.message : String(err);
          panel.postMessage({
            type: 'moveFailed',
            itemId: message.itemId,
            targetOptionId: message.targetOptionId,
            message: errorText,
          });
          void vscode.window.showErrorMessage(`Failed to move card: ${errorText}`);
        });
        return;
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      panel.postMessage({ type: 'error', message: text });
      void vscode.window.showErrorMessage(text);
    }
  };

  const disposable = vscode.commands.registerCommand('githubKanban.openBoard', async () => {
    try {
      const session = await getRequiredGitHubSession(GITHUB_SCOPES);
      accessToken = session.accessToken;
      let urlStr = getConfiguredUrl();

      if (!urlStr) {
        urlStr = await detectProjectUrlFromWorkspace(accessToken);
      }
      if (!urlStr) {
        const choice = await vscode.window.showErrorMessage(
          'No GitHub project URL configured, and no project was auto-detected from workspace repository.',
          'Open Settings'
        );
        if (choice === 'Open Settings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_URL_PATH);
        }
        return;
      }

      const validation = validateKanbanUrl(urlStr);
      if (!validation.ok) {
        await vscode.window.showErrorMessage(`Invalid URL: ${validation.reason}`);
        return;
      }

      if (panel) {
        panel.reveal();
        await refreshBoard(urlStr);
        return;
      }

      panel = new KanbanPanel(context.extensionUri, async (message) => handleMessage(urlStr, message));
      context.subscriptions.push(panel.onDidDispose(() => {
        panel = undefined;
        currentBoard = undefined;
      }));
      await refreshBoard(urlStr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await vscode.window.showErrorMessage(
        `Failed to open integrated Kanban board. Details: ${message}`
      );
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // no-op
}

