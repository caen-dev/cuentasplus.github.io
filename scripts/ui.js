import { clients } from './state.js?v=20260928-8';
import { money, normalizeSearchText, parseLocalDate } from './utils.js?v=20260928-8';
import { filterTransactions, transactionTypeLabel } from './history.js?v=20260928-8';

export function updateClientSelect() {
  const $select = $('#select-client');
  const selectedClient = $select.val();
  $select.empty();
  $select.append(new Option('Seleccionar cliente…', ''));

  const keys = Object.keys(clients).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    $select.append(new Option('— No hay clientes —', ''));
    $select.val('');
    return;
  }
  keys.forEach((name) => $select.append(new Option(name, name)));
  $select.val(keys.includes(selectedClient) ? selectedClient : '');
}

export function updateClientDebtList() {
  const $tbody = $('#debt-list tbody').empty();
  const search = String($('#debt-search').val() || '').trim().toLocaleLowerCase('es-AR');
  const filter = $('#client-list-filter').val() || 'all';
  const sort = $('#client-list-sort').val() || 'activity';
  const orderedClients = sortClients(filterClients(Object.values(clients), search, filter), sort);
  $('#client-list-count').text(
    `Mostrando ${orderedClients.length} de ${Object.keys(clients).length} cliente(s).`
  );
  const hasClients = Object.keys(clients).length > 0;
  $('#getting-started').prop('hidden', hasClients);
  if (!orderedClients.length) {
    const emptyMessage = hasClients
      ? 'No hay clientes que coincidan con la búsqueda y el filtro.'
      : 'Todavía no hay clientes. Agregá uno para comenzar.';
    $tbody.append($('<tr>').append($('<td colspan="3">').addClass('text-muted text-center').text(emptyMessage)));
    return;
  }

  orderedClients.forEach((c, index) => {
    const transactions = c.transactions || [];
    const infoId = `client-info-${index}`;
    const latestTransaction = getLatestTransaction(transactions);

    const $btns = $('<div>')
      .addClass('btn-container')
      .append(
        $('<button>')
          .attr('type', 'button')
          .addClass('btn btn-info btn-sm toggle-info')
          .attr('title', 'Ver información e historial')
          .attr('aria-label', `Ver información de ${c.name}`)
          .attr('aria-controls', infoId)
          .attr('aria-expanded', 'false')
          .html('<i class="fas fa-info-circle"></i>')
          .data('client', c.name),
        $('<button>')
          .attr('type', 'button')
          .addClass('btn btn-warning btn-sm edit-client')
          .attr('title', 'Editar cliente')
          .attr('aria-label', `Editar ${c.name}`)
          .html('<i class="fas fa-edit"></i>')
          .data('client', c.name)
      );

    const address = [c.street, c.number].filter((part) => part && part !== '-').join(' ');
    const $contact = $('<div>').addClass('client-contact')
      .append($('<span>').text(c.phone || 'Sin teléfono'));
    if (address) $contact.append($('<span>').text(address));

    const movementLabel = `${transactions.length} ${transactions.length === 1 ? 'movimiento' : 'movimientos'}`;
    const $movement = $('<div>').addClass('client-movement')
      .append($('<strong>').text(movementLabel));
    $movement.append($('<span>').text(latestTransaction ? `Último: ${latestTransaction.date}` : 'Sin actividad'));

    const balance = Number(c.balance) || 0;
    const $balance = $('<td>').addClass(balance > 0 ? 'client-balance has-debt' : 'client-balance')
      .text(money(balance));

    const $clientName = $('<div>').addClass('client-name-line')
      .append($('<strong>').text(c.name), $btns);
    const $row = $('<tr>').append(
      $('<td>').addClass('client-name-cell').append($clientName, $contact),
      $('<td>').append($movement),
      $balance
    );

    const $personalInfo = $('<div>').addClass('client-info-grid').append(
      $('<p>').append($('<strong>').text('Teléfono: '), document.createTextNode(c.phone || '-')),
      $('<p>').append(
        $('<strong>').text('Domicilio: '),
        document.createTextNode([c.street, c.number].filter((part) => part && part !== '-').join(' ') || '-')
      )
    );
    const $historyContent = transactions.length
      ? $('<div>').addClass('client-history-table-wrap').append(buildTransactionHistoryTable(transactions))
      : $('<p>').addClass('text-muted').text('Este cliente todavía no tiene movimientos.');
    const $history = $('<section>').addClass('client-history').append(
      $('<h3>').text(`Historial de movimientos (${transactions.length})`),
      $historyContent
    );
    const $infoRow = $('<tr>').addClass('personal-info-row').attr({ id: infoId, 'aria-hidden': 'true' }).hide()
      .append($('<td colspan="3">').append($personalInfo, $history));

    $tbody.append($row, $infoRow);
  });
}

export function searchClients(clientList, query) {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (!normalizedQuery) return [];
  return clientList
    .map((client) => {
      const name = normalizeSearchText(client.name);
      const contact = normalizeSearchText(
        [client.phone, client.street, client.number].filter(Boolean).join(' ')
      );
      const nameMatch = name.includes(normalizedQuery);
      const contactMatch = contact.includes(normalizedQuery);
      if (!nameMatch && !contactMatch) return null;
      const score = name === normalizedQuery ? 0
        : name.startsWith(normalizedQuery) ? 1
          : nameMatch ? 2
            : contactMatch ? 3 : 4;
      return { client, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.client.name.localeCompare(b.client.name, 'es-AR'))
    .map(({ client }) => client);
}

function renderClientSuggestions(query) {
  const input = document.getElementById('client-filter');
  const list = document.getElementById('client-search-results');
  const status = document.getElementById('client-search-status');
  if (!input || !list || !status) return;

  const allMatches = searchClients(Object.values(clients), query);
  const matches = allMatches.slice(0, 8);
  list.replaceChildren();
  input.removeAttribute('aria-activedescendant');
  if (!matches.length) {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    status.textContent = query.trim() ? 'No se encontraron clientes.' : '';
    return;
  }

  matches.forEach((client, index) => {
    const option = document.createElement('li');
    option.id = `client-search-option-${index}`;
    option.className = 'client-search-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const name = document.createElement('strong');
    name.textContent = client.name;
    const details = document.createElement('span');
    details.textContent = [client.phone, client.street, client.number].filter((part) => part && part !== '-').join(' · ');
    option.append(name, details);
    option.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') event.preventDefault();
    });
    option.addEventListener('click', () => selectSearchClient(client));
    list.append(option);
  });

  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  status.textContent = allMatches.length > matches.length
    ? `Se muestran ${matches.length} de ${allMatches.length} clientes.`
    : `${allMatches.length} ${allMatches.length === 1 ? 'cliente encontrado' : 'clientes encontrados'}.`;
}

function selectSearchClient(client) {
  $('#select-client').val(client.name).trigger('change');
  $('#client-filter').val(client.name).attr('aria-expanded', 'false').removeAttr('aria-activedescendant');
  $('#client-search-results').empty().prop('hidden', true);
  $('#client-search-status').text(`Cliente seleccionado: ${client.name}.`);
}

function buildTransactionHistoryTable(transactions) {
  const $table = $('<table>').addClass('table table-sm table-striped client-history-table');
  $table.append(
    $('<caption>').addClass('sr-only').text('Historial completo de movimientos del cliente'),
    $('<thead>').append($('<tr>').append(
      $('<th scope="col">').text('Fecha'),
      $('<th scope="col">').text('Tipo'),
      $('<th scope="col">').text('Monto'),
      $('<th scope="col">').text('Método')
    ))
  );
  const $tbody = $('<tbody>');
  filterTransactions(transactions).forEach((transaction) => {
    $tbody.append($('<tr>').append(
      $('<td>').text(transaction.date),
      $('<td>').text(transactionTypeLabel(transaction.type)),
      $('<td>').text(money(transaction.amountCents ?? transaction.amount ?? 0)),
      $('<td>').text(transaction.paymentMethod || '-')
    ));
  });
  return $table.append($tbody);
}

export function filterClients(clientList, search = '', filter = 'all') {
  const query = normalizeSearchText(search.trim());
  return clientList.filter((client) => {
    if (filter === 'debt' && !(Number(client.balance) > 0)) return false;
    const searchable = normalizeSearchText(
      [client.name, client.phone, client.street, client.number].filter(Boolean).join(' ')
    );
    return searchable.includes(query);
  });
}

export function sortClients(clientList, sort = 'activity') {
  const clientsWithActivity = clientList.map((client) => ({
    client,
    latestActivity: parseLocalDate(getLatestTransaction(client.transactions || [])?.date)?.getTime() || 0
  }));

  clientsWithActivity.sort((a, b) => {
    if (sort === 'name') return a.client.name.localeCompare(b.client.name, 'es-AR');
    if (sort === 'balance') {
      const balanceOrder = (Number(b.client.balance) || 0) - (Number(a.client.balance) || 0);
      if (balanceOrder) return balanceOrder;
    } else {
      const activityOrder = b.latestActivity - a.latestActivity;
      if (activityOrder) return activityOrder;
    }
    return a.client.name.localeCompare(b.client.name, 'es-AR');
  });

  return clientsWithActivity.map(({ client }) => client);
}

export function getLatestTransaction(transactions) {
  return transactions.reduce((latest, transaction) => {
    const date = parseLocalDate(transaction.date);
    return date && (!latest || date > latest.date) ? { transaction, date } : latest;
  }, null)?.transaction;
}

export function initTableInteractions() {
  // Mostrar info personal
  $(document).on('click', '.toggle-info', function () {
    const $button = $(this);
    const expanded = $button.attr('aria-expanded') === 'true';
    $button.attr('aria-expanded', String(!expanded));
    const $infoRow = $button.closest('tr').next('.personal-info-row');
    $infoRow.attr('aria-hidden', String(expanded)).stop(true, true);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      $infoRow.toggle(!expanded);
    } else {
      $infoRow.slideToggle();
    }
  });

  // Filtro de texto
  $('#debt-search').on('input', function () {
    updateClientDebtList();
  });
  $('#client-list-filter').on('change', updateClientDebtList);
  $('#client-list-sort').on('change', updateClientDebtList);

  const $clientSearch = $('#client-filter');
  let activeOption = -1;
  $clientSearch.on('input', function () {
    const query = this.value;
    if (query !== $('#select-client').val()) $('#select-client').val('');
    activeOption = -1;
    renderClientSuggestions(query);
  });
  $clientSearch.on('keydown', function (event) {
    const options = document.querySelectorAll('#client-search-results [role="option"]');
    if (event.key === 'Escape') {
      $('#client-search-results').empty().prop('hidden', true);
      this.setAttribute('aria-expanded', 'false');
      this.removeAttribute('aria-activedescendant');
      activeOption = -1;
      return;
    }
    if (!options.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.key === 'Enter') {
      if (activeOption >= 0 && options[activeOption]) {
        event.preventDefault();
        options[activeOption].dispatchEvent(new Event('click'));
      } else if (options.length === 1) {
        event.preventDefault();
        options[0].dispatchEvent(new Event('click'));
      }
      return;
    }
    event.preventDefault();
    activeOption = event.key === 'ArrowDown'
      ? (activeOption + 1) % options.length
      : (activeOption <= 0 ? options.length - 1 : activeOption - 1);
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeOption)));
    this.setAttribute('aria-activedescendant', options[activeOption].id);
  });
  $clientSearch.on('blur', () => {
    setTimeout(() => {
      $('#client-search-results').empty().prop('hidden', true);
      $clientSearch.attr('aria-expanded', 'false').removeAttr('aria-activedescendant');
    }, 120);
  });
  $('#select-client').on('change', function () {
    const client = clients[this.value];
    if (client) {
      $('#client-filter').val(client.name);
      $('#client-search-status').text(`Cliente seleccionado: ${client.name}.`);
      $('#client-search-results').empty().prop('hidden', true);
      $('#client-filter').attr('aria-expanded', 'false').removeAttr('aria-activedescendant');
    }
  });
}
