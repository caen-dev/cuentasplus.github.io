'use strict';

import { clients } from './state.js?v=20260928-8';
import { escapeHtml, money, parseLocalDate } from './utils.js?v=20260928-8';
import * as uiAlerts from './uiAlerts.js?v=20260928-18';

export function initDashboard() {
  $('#refresh-stats-btn').on('click', () => {
    updateStats();
    uiAlerts.toast('Resumen actualizado');
  });

  $('.stat-card').on('click', (e) => showCardModal($(e.currentTarget).data('type')));
}

// --------------------------------------------------------

function showCardModal(type) {
  const styleClass = document.body.classList.contains('dark-mode') ? 'swal2-dark' : 'swal2-light';

  if (type === 'clients') return modalClients(styleClass);
  if (type === 'debt') return modalDebt(styleClass);
  if (type === 'payments') return modalPayments(styleClass);
  if (type === 'debtors') return modalDebtors(styleClass);
}

// -------------------------- MODALES ----------------------

function modalClients(styleClass) {
  const rows = Object.values(clients)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c =>
      `<tr><td>${escapeHtml(c.name)}</td><td>${money(c.balance)}</td><td>${escapeHtml(c.phone)}</td></tr>`
    ).join('') || `<tr><td colspan="3" class="text-muted">Sin clientes</td></tr>`;

  Swal.fire({
    title: 'Clientes registrados',
    html: wrapTable(`
      <thead><tr><th scope="col">Cliente</th><th scope="col">Saldo</th><th scope="col">Teléfono</th></tr></thead>
      <tbody>${rows}</tbody>`, 'Clientes, saldo y teléfono'),
    customClass: { popup: styleClass },
    confirmButtonColor: uiAlerts.getThemeColors().accent
  });
}

function modalDebt(styleClass) {
  const list = Object.values(clients)
    .filter(c => (Number(c.balance) || 0) > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10);

  const rows = list.length
    ? list.map(c =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${money(c.balance)}</td></tr>`
      ).join('')
    : `<tr><td colspan="2" class="text-muted">No hay deudores</td></tr>`;

  Swal.fire({
    title: 'Top deudores',
    html: wrapTable(`
      <thead><tr><th scope="col">Cliente</th><th scope="col">Deuda</th></tr></thead>
      <tbody>${rows}</tbody>`, 'Clientes con mayor deuda'),
    icon: list.length ? 'info' : 'success',
    customClass: { popup: styleClass },
    confirmButtonColor: uiAlerts.getThemeColors().accent
  });
}

function modalPayments(styleClass) {
  const now = new Date();
  const pagos = [];

  Object.values(clients).forEach(c =>
    (c.transactions || []).forEach(t => {
      if (t.type !== 'payment' && t.type !== 'Pago') return;
      const d = parseLocalDate(t.date);
      if (!d) return;
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        pagos.push({ cliente: c.name, ...t });
      }
    })
  );

  const rows = pagos.length
    ? pagos
        .sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date))
        .slice(0, 20)
        .map(p =>
          `<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.cliente)}</td><td>${money(p.amountCents ?? p.amount ?? 0)}</td><td>${escapeHtml(p.paymentMethod)}</td></tr>`
        ).join('')
    : `<tr><td colspan="4" class="text-muted">Sin pagos este mes</td></tr>`;

  Swal.fire({
    title: 'Pagos del mes',
    html: wrapTable(`
      <thead><tr><th scope="col">Fecha</th><th scope="col">Cliente</th><th scope="col">Monto</th><th scope="col">Método</th></tr></thead>
      <tbody>${rows}</tbody>`, 'Pagos del mes'),
    customClass: { popup: styleClass },
    confirmButtonColor: uiAlerts.getThemeColors().accent
  });
}

function modalDebtors(styleClass) {
  const list = Object.values(clients)
    .filter(c => (Number(c.balance) || 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = list.length
    ? list.map(d =>
        `<tr><td>${escapeHtml(d.name)}</td><td>${money(d.balance)}</td></tr>`
      ).join('')
    : `<tr><td colspan="2" class="text-muted">Sin clientes con deuda</td></tr>`;

  Swal.fire({
    title: 'Clientes con deuda',
    html: wrapTable(`
      <thead><tr><th scope="col">Cliente</th><th scope="col">Saldo</th></tr></thead>
      <tbody>${rows}</tbody>`, 'Clientes con saldo pendiente'),
    customClass: { popup: styleClass },
    confirmButtonColor: uiAlerts.getThemeColors().accent
  });
}

// -------------------------- HELPERS ----------------------

function wrapTable(innerHTML, caption) {
  return `
    <div class="table-responsive">
      <table class="table table-sm table-striped mb-0">
        <caption class="sr-only">${caption}</caption>
        ${innerHTML}
      </table>
    </div>`;
}

// --------------------------------------------------------
export function updateStats() {
  const { totalClients, totalDebt, debtorsCount, monthPayments } = computeStats();
  $('#stat-total-clients').text(totalClients.toLocaleString('es-AR'));
  $('#stat-total-debt').text(money(totalDebt));
  $('#stat-debtors-count').text(debtorsCount.toLocaleString('es-AR'));
  $('#stat-month-payments').text(money(monthPayments));
}

function computeStats() {
  const now = new Date();
  let totalDebt = 0, debtorsCount = 0, monthPayments = 0;

  const list = Object.values(clients);
  list.forEach(c => {
    const bal = Number(c.balance) || 0;
    totalDebt += bal;
    if (bal > 0) debtorsCount++;

    (c.transactions || []).forEach(t => {
      if (t.type !== 'payment' && t.type !== 'Pago') return;
      const d = parseLocalDate(t.date);
      if (!d) return;
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        monthPayments += Number(t.amountCents ?? t.amount ?? 0) || 0;
      }
    });
  });

  return {
    totalClients: list.length,
    totalDebt,
    debtorsCount,
    monthPayments
  };
}
