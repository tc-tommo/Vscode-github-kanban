(function () {
  const vscode = acquireVsCodeApi();

  let board = null;
  let draggingItemId = null;
  const pendingMoves = new Map();
  const selectedItemIds = new Set();
  let lastSelectedItemId = null;
  let orderedCardIds = [];

  const titleEl = document.getElementById('board-title');
  const statusEl = document.getElementById('status');
  const boardEl = document.getElementById('board');
  const refreshBtn = document.getElementById('refresh-btn');

  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshRequested' });
  });
  boardEl.addEventListener('click', (event) => {
    if (event.target === boardEl) {
      selectedItemIds.clear();
      lastSelectedItemId = null;
      renderBoard();
    }
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
    orderedCardIds = [];

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
        applyDropMove(column.optionId);
      });

      const cards = board.cards.filter((card) => {
        if (column.optionId === '__UNASSIGNED__') {
          return !card.statusOptionId;
        }
        return card.statusOptionId === column.optionId;
      });

      for (const card of cards) {
        orderedCardIds.push(card.itemId);
        const cardEl = document.createElement('article');
        cardEl.className = 'card';
        if (selectedItemIds.has(card.itemId)) {
          cardEl.classList.add('selected');
        }
        cardEl.draggable = true;
        cardEl.addEventListener('click', (event) => {
          if (event.target instanceof HTMLAnchorElement) {
            return;
          }
          handleCardSelection(event, card.itemId);
        });
        cardEl.addEventListener('dragstart', (event) => {
          if (!selectedItemIds.has(card.itemId)) {
            selectedItemIds.clear();
            selectedItemIds.add(card.itemId);
            lastSelectedItemId = card.itemId;
          }
          draggingItemId = card.itemId;
          cardEl.classList.add('dragging');
          const payload = formatCardDropText(getSelectedOrDraggedCards(card.itemId));
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData('text/plain', payload);
            if (card.url && getSelectedOrDraggedCards(card.itemId).length === 1) {
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

  function formatCardDropText(cards) {
    if (!cards.length) {
      return 'GitHub Project items';
    }
    if (cards.length === 1) {
      const card = cards[0];
      if (card.url) {
        return `[GitHub Project item][${card.contentType}]: ${card.title} (${card.url})`;
      }
      return `[GitHub Project item][${card.contentType}]: ${card.title}`;
    }

    const lines = [
      `GitHub Project items (${cards.length})`,
      ...cards.map((card, idx) => `${idx + 1}. [${card.contentType}] ${card.title}${card.url ? ` (${card.url})` : ''}`),
    ];
    return lines.join('\n');
  }

  function getSelectedOrDraggedCards(fallbackItemId) {
    const ids = selectedItemIds.size ? Array.from(selectedItemIds) : [fallbackItemId];
    return ids
      .map((id) => board.cards.find((card) => card.itemId === id))
      .filter(Boolean);
  }

  function handleCardSelection(event, itemId) {
    if (event.shiftKey && lastSelectedItemId) {
      const from = orderedCardIds.indexOf(lastSelectedItemId);
      const to = orderedCardIds.indexOf(itemId);
      if (from >= 0 && to >= 0) {
        selectedItemIds.clear();
        const [start, end] = from < to ? [from, to] : [to, from];
        for (let i = start; i <= end; i += 1) {
          selectedItemIds.add(orderedCardIds[i]);
        }
        renderBoard();
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      if (selectedItemIds.has(itemId)) {
        selectedItemIds.delete(itemId);
      } else {
        selectedItemIds.add(itemId);
      }
      lastSelectedItemId = itemId;
      renderBoard();
      return;
    }

    selectedItemIds.clear();
    selectedItemIds.add(itemId);
    lastSelectedItemId = itemId;
    renderBoard();
  }

  function applyDropMove(targetOptionId) {
    if (!board || !draggingItemId || targetOptionId === '__UNASSIGNED__') {
      return;
    }

    const idsToMove = selectedItemIds.size
      ? Array.from(selectedItemIds)
      : [draggingItemId];

    const targetColumn = board.columns.find((column) => column.optionId === targetOptionId);
    for (const itemId of idsToMove) {
      const card = board.cards.find((c) => c.itemId === itemId);
      if (!card || card.statusOptionId === targetOptionId) {
        continue;
      }
      pendingMoves.set(itemId, {
        previousOptionId: card.statusOptionId,
        previousStatusName: card.statusName,
        targetOptionId,
      });
      card.statusOptionId = targetOptionId;
      card.statusName = targetColumn ? targetColumn.name : card.statusName;
      vscode.postMessage({
        type: 'moveCard',
        itemId,
        targetOptionId,
      });
    }
    renderBoard();
  }
})();

