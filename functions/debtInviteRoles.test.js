const test = require("node:test");
const assert = require("node:assert/strict");
const { acceptInviteParticipant, debtCancellationMode, isPendingInviteCreator, isPendingInvitee } = require("./debtInviteRoles");

test("debtor-created link is accepted by the creditor and preserves the debtor", () => {
  const draft = { debtorUid: "debtor-1", debtorName: "Dao", creditorUid: null, creditorName: "Mai", outstandingAmount: 250, pendingCounterpartyRole: "creditor" };
  const creditor = { uid: "creditor-1", name: "Mai account", email: "mai@example.com" };
  assert.equal(isPendingInviteCreator(draft, "debtor-1"), true);
  assert.equal(isPendingInvitee(draft, "creditor-1"), false);
  assert.deepEqual(acceptInviteParticipant(draft, creditor), { ...draft, creditorUid: "creditor-1", creditorName: "Mai", creditorEmail: "mai@example.com", status: "active", agreementStatus: "accepted" });
});

test("debtor-created direct invite identifies the creditor as the only invitee", () => {
  const direct = { debtorUid: "debtor-1", creditorUid: "creditor-1", directInviteRole: "creditor", pendingCounterpartyRole: "creditor" };
  assert.equal(isPendingInviteCreator(direct, "debtor-1"), true);
  assert.equal(isPendingInvitee(direct, "creditor-1"), true);
  assert.equal(isPendingInvitee(direct, "debtor-1"), false);
});

test("debtor creator can cancel an unaccepted link without a missing-counterparty consent request", () => {
  const pending = { status: "pending", agreementStatus: "awaiting_creditor", debtorUid: "debtor-1", creditorUid: null, pendingCounterpartyRole: "creditor" };
  assert.equal(debtCancellationMode(pending, "debtor-1"), "direct");
});

test("a direct invitee cannot cancel before accepting, while its creator can", () => {
  const pending = { status: "pending", agreementStatus: "awaiting_creditor", debtorUid: "debtor-1", creditorUid: "creditor-1", pendingCounterpartyRole: "creditor" };
  assert.equal(debtCancellationMode(pending, "debtor-1"), "direct");
  assert.equal(debtCancellationMode(pending, "creditor-1"), "forbidden");
});

test("an accepted shared debt requires the other party's consent", () => {
  const active = { status: "active", agreementStatus: "accepted", debtorUid: "debtor-1", creditorUid: "creditor-1" };
  assert.equal(debtCancellationMode(active, "debtor-1"), "consent");
  assert.equal(debtCancellationMode(active, "creditor-1"), "consent");
});
