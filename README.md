# GitHub Kanban Viewer (VS Code Extension)

Open and manage a GitHub Projects (v2) Kanban board directly inside VS Code.

## Setup

1. Open this folder in VS Code.
2. Install dependencies:
   - `npm install`
3. Compile:
   - `npm run compile`
4. Press **F5** to run the extension in the Extension Development Host.

## Configure the Kanban URL

Set the setting `githubKanban.url` to the URL of your Projects Kanban view, for example:

`https://github.com/orgs/<org>/projects/<projectNumber>/views/<viewId>`

## Use the command

Run `GitHub Kanban: Open Board`.

It will:
- require a VS Code GitHub authentication session (`github` provider),
- use GitHub GraphQL to load your Projects v2 board data,
- open an integrated Kanban webview in VS Code,
- allow drag-and-drop card moves between `Status` columns (applied immediately).

## Limitations / Known Issues

- This version supports **Projects v2** only.
- It currently expects a `Status` single-select field in the project.
- It loads the first page of items (`first: 100`); very large projects will require pagination enhancements.
- Card ordering within a column is not persisted yet; status transitions are persisted.

