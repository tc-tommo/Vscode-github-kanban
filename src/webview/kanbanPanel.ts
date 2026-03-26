import * as vscode from 'vscode';
import { getKanbanHtml } from './kanbanHtml';
import { KanbanBoard } from '../github/projectClient';

export type WebviewInboundMessage =
  | { type: 'refreshRequested' }
  | { type: 'moveCard'; itemId: string; targetOptionId: string };

export type WebviewOutboundMessage =
  | { type: 'boardData'; board: KanbanBoard }
  | { type: 'moveSucceeded'; itemId: string; targetOptionId: string }
  | { type: 'moveFailed'; itemId: string; targetOptionId: string; message: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; message: string };

export class KanbanPanel {
  private panel: vscode.WebviewPanel;

  constructor(
    extensionUri: vscode.Uri,
    onMessage: (message: WebviewInboundMessage) => Promise<void>
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'githubKanbanPanel',
      'GitHub Kanban',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = getKanbanHtml(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
      void onMessage(message);
    });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  dispose(): void {
    this.panel.dispose();
  }

  onDidDispose(listener: () => void): vscode.Disposable {
    return this.panel.onDidDispose(listener);
  }

  postMessage(message: WebviewOutboundMessage): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  setTitle(title: string): void {
    this.panel.title = title;
  }
}

