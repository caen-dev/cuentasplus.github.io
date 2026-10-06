CUENTAS+ — CONTRATO MONETARIO

1. ARS es la única moneda soportada actualmente.
2. Todo valor monetario interno se expresa en centavos enteros.
3. amountCents es la fuente de verdad de una transacción.
4. balance es saldo en centavos enteros.
5. amount queda solo como compatibilidad temporal.
6. La entrada de usuario se convierte mediante parseMoneyToCents().
7. La visualización se realiza mediante formatMoneyFromCents().
8. Los cálculos se realizan con enteros.
9. Un backup nuevo debe declarar explícitamente su formato monetario.
10. Un backup antiguo se migra mediante reglas explícitas; nunca por tamaño del número.
