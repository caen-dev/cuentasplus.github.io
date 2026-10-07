'use strict';

import { clients } from './state.js?v=20260928-8';
import { saveClient } from './db.js?v=20260928-8';
import { updateClientDebtList, updateClientSelect } from './ui.js?v=20260928-18';
import { updateStats } from './dashboard.js?v=20260928-15';
import { todayStr, isEmpty, formatMoneyLive } from './utils.js?v=20260928-8';
import {
  MAX_MONEY_CENTS,
  parseMoneyToCents,
  formatMoneyFromCents,
  addCents,
  subtractCents
} from './currency.js';
import * as uiAlerts from './uiAlerts.js?v=20260928-18';

export function initTransactions() {
  const $amount = $('#amount');

  // Formateo en vivo
  $amount.on('input', function () {
    const formatted = formatMoneyLive(this.value);
    this.value = formatted;
    this.setSelectionRange(formatted.length, formatted.length);
  });
  $amount.on('blur', function () { this.value = formatMoneyLive(this.value); });
  $amount.on('focus', function () { setTimeout(() => this.select(), 0); });

  // Submit
  $('#account-form').on('submit', async function (e) {
    e.preventDefault();
    const clientName = $('#select-client').val();
    const type = $('#transaction-type').val();
    const rawAmount = $('#amount').val();
    const amountCents = parseMoneyToCents(rawAmount);
    const method = $('#payment-method').val();

    if (isEmpty(clientName))
      return uiAlerts.warning('Seleccione un cliente', 'Debes elegir un cliente.');
    if (!Number.isFinite(amountCents) || amountCents <= 0)
      return uiAlerts.error('Monto inválido', 'Ingrese un monto mayor que cero.');

    const $submit = $('#account-form button[type="submit"]').prop('disabled', true);
    let saved;
    try {
      saved = await handleTransaction(clientName, type, amountCents, method);
    } catch (err) {
      console.error(err);
      uiAlerts.error('No se pudo guardar la transacción', err?.message || String(err));
    } finally {
      $submit.prop('disabled', false);
    }
    if (!saved) return;

    $('#select-client').val('').trigger('change');
    $('#account-form').trigger('reset');
    $('#client-filter').val('');
    $('#client-search-status').text('');
    updateClientSelect();
  });
}

async function handleTransaction(clientName, type, amountCents, paymentMethod) {
  const c = clients[clientName];
  if (!c) {
    uiAlerts.error('Error', 'El cliente no existe.');
    return false;
  }

  const date = todayStr();
  let transaction;
  let balanceCents = Number(c.balance) || 0;

  if (type === 'purchase') {
    const updatedBalance = addCents(balanceCents, amountCents);
    if (
      !Number.isSafeInteger(updatedBalance) ||
      updatedBalance < 0 ||
      updatedBalance > MAX_MONEY_CENTS
    ) {
      uiAlerts.error('Monto inválido', 'El total de la deuda supera el límite permitido.');
      return false;
    }
    balanceCents = updatedBalance;
    transaction = {
      type: 'purchase',
      amountCents,
      amount: amountCents,
      date,
      paymentMethod
    };
  } else if (type === 'payment') {
    if (balanceCents <= 0) {
      uiAlerts.warning('Sin deuda', 'Este cliente no tiene deuda pendiente.');
      return false;
    }
    if (amountCents > balanceCents) {
      return uiAlerts.warning(
        'Monto excedido',
        `El pago supera la deuda actual (${formatMoneyFromCents(Number(c.balance) || 0)}).`
      );
    }
    transaction = {
      type: 'payment',
      amountCents,
      amount: amountCents,
      date,
      paymentMethod
    };
    balanceCents = subtractCents(balanceCents, amountCents);
  } else {
    uiAlerts.error('Tipo inválido', 'Tipo de transacción desconocido.');
    return false;
  }

  const updatedClient = {
    ...c,
    balance: balanceCents,
    transactions: [...(c.transactions || []), transaction]
  };

  await saveClient(updatedClient);
  clients[clientName] = updatedClient;
  updateClientDebtList();
  updateStats();
  uiAlerts.toast('Transacción registrada correctamente 💰');
  return true;
}
