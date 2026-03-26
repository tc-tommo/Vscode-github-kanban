(function () {
  const vscode = acquireVsCodeApi();

  let board = null;
  let draggingItemId = null;
  const pendingMoves = new Map();

  const titleEl = document.getElementById('board-title');
  const statusEl = document.getElementById('status');
  const boardEl = document.getElementById('board');
  const refreshBtn = document.getElementById('refresh-btn');

  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshRequested' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }

    if (msg.type === 'loading') {
      setStatus(msg.message);
      return;
    }

    if (msg.type === 'error') {
      setStatus(msg.message);
      return;
    }

    if (msg.type === 'boardData') {
      board = msg.board;
      setStatus('');
      titleEl.textContent = `GitHub Kanban - ${board.title}`;
      renderBoard();
      return;
    }

    if (msg.type === 'moveSucceeded' && board) {
      pendingMoves.delete(msg.itemId);
      return;
    }

    if (msg.type === 'moveFailed' && board) {
      const pending = pendingMoves.get(msg.itemId);
      if (!pending || pending.targetOptionId !== msg.targetOptionId) {
        setStatus(`Move failed: ${msg.message}`);
        return;
      }
      const card = board.cards.find((c) => c.itemId === msg.itemId);
      if (card) {
        card.statusOptionId = pending.previousOptionId;
        card.statusName = pending.previousStatusName;
      }
      pendingMoves.delete(msg.itemId);
      setStatus(`Move failed: ${msg.message}`);
      renderBoard();
      return;
    }
  });

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function renderBoard() {
    boardEl.textContent = '';
    if (!board) {
      return;
    }

    const unassigned = {
      optionId: '__UNASSIGNED__',
      name: 'Unassigned',
    };
    const columns = board.columns.concat(unassigned);

    for (const column of columns) {
      const columnEl = document.createElement('div');
      columnEl.className = 'column';
      columnEl.dataset.optionId = column.optionId;

      const heading = document.createElement('h3');
      heading.textContent = column.name;
      columnEl.appendChild(heading);

      const cardList = document.createElement('div');
      cardList.className = 'card-list';
      cardList.addEventListener('dragover', (event) => {
        event.preventDefault();
        cardList.classList.add('drop-target');
      });
      cardList.addEventListener('dragleave', () => {
        cardList.classList.remove('drop-target');
      });
      cardList.addEventListener('drop', (event) => {
        event.preventDefault();
        cardList.classList.remove('drop-target');
        if (!draggingItemId || column.optionId === '__UNASSIGNED__') {
          return;
        }
        const card = board.cards.find((c) => c.itemId === draggingItemId);
        if (!card || card.statusOptionId === column.optionId) {
          return;
        }
        pendingMoves.set(draggingItemId, {
          previousOptionId: card.statusOptionId,
          previousStatusName: card.statusName,
          targetOptionId: column.optionId,
        });
        card.statusOptionId = column.optionId;
        card.statusName = column.name;
        renderBoard();
        vscode.postMessage({
          type: 'moveCard',
          itemId: draggingItemId,
          targetOptionId: column.optionId,
        });
      });

      const cards = board.cards.filter((card) => {
        if (column.optionId === '__UNASSIGNED__') {
          return !card.statusOptionId;
        }
        return card.statusOptionId === column.optionId;
      });

      for (const card of cards) {
        const cardEl = document.createElement('article');
        cardEl.className = 'card';
        cardEl.draggable = true;
        cardEl.addEventListener('dragstart', (event) => {
          draggingItemId = card.itemId;
          cardEl.classList.add('dragging');
          const payload = formatCardDropText(card);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData('text/plain', payload);
            if (card.url) {
              event.dataTransfer.setData('text/uri-list', card.url);
            }
          }
        });
        cardEl.addEventListener('dragend', () => {
          draggingItemId = null;
          cardEl.classList.remove('dragging');
        });

        const title = document.createElement('div');
        title.className = 'card-title';
        if (card.url) {
          const link = document.createElement('a');
          link.href = card.url;
          link.textContent = card.title;
          link.target = '_blank';
          title.appendChild(link);
        } else {
          title.textContent = card.title;
        }

        const iconWrap = document.createElement('div');
        iconWrap.className = 'card-type-icon';
        const icon = document.createElement('i');
        icon.className = getCardTypeIconClass(card.contentType);
        icon.setAttribute('aria-label', card.contentType);
        icon.setAttribute('title', card.contentType);
        iconWrap.appendChild(icon);

        cardEl.appendChild(title);
        cardEl.appendChild(iconWrap);
        cardList.appendChild(cardEl);
      }

      columnEl.appendChild(cardList);
      boardEl.appendChild(columnEl);
    }
  }

  vscode.postMessage({ type: 'refreshRequested' });

  function getCardTypeIconClass(contentType) {
    if (contentType === 'Issue') {
      return 'fa-solid fa-circle-exclamation';
    }
    if (contentType === 'PullRequest') {
      return 'fa-solid fa-code-pull-request';
    }
    if (contentType === 'DraftIssue') {
      return 'fa-solid fa-file-pen';
    }
    return 'fa-solid fa-circle-question';
  }

  function formatCardDropText(card) {
    if (card.url) {
      return `[GitHub Project item][${card.contentType}]: ${card.title} (${card.url})`;
    }
    return `[GitHub Project item][${card.contentType}]: ${card.title}`;
  }
})();

