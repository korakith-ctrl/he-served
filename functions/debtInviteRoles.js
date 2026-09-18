function pendingCounterpartyRole(debt) {
  return debt?.pendingCounterpartyRole === "creditor" ? "creditor" : "debtor";
}

function isPendingInvitee(debt, uid) {
  return pendingCounterpartyRole(debt) === "creditor" ? debt?.creditorUid === uid : debt?.debtorUid === uid;
}

function isPendingInviteCreator(debt, uid) {
  return pendingCounterpartyRole(debt) === "creditor" ? debt?.debtorUid === uid : debt?.creditorUid === uid;
}

function debtCancellationMode(debt, uid) {
  if (!debt || debt.status === "cancelled") return "done";
  const awaitingCounterparty = ["pending", "invite_revoked"].includes(debt.status) && debt.agreementStatus !== "accepted";
  if (awaitingCounterparty) return isPendingInviteCreator(debt, uid) ? "direct" : "forbidden";
  if (debt.creditorUid && debt.debtorUid) return "consent";
  return debt.creditorUid === uid ? "direct" : "forbidden";
}

// Keeps the role reversal in one testable place.  The callable adds audit,
// agreement, and notification records around this participant update.
function acceptInviteParticipant(debt, user) {
  if (pendingCounterpartyRole(debt) === "creditor") {
    return {
      ...debt,
      creditorUid: user.uid,
      creditorName: debt.creditorName || user.name,
      creditorEmail: user.email,
      status: Number(debt.outstandingAmount) > 0 ? "active" : "paid",
      agreementStatus: "accepted",
    };
  }
  return {
    ...debt,
    debtorUid: user.uid,
    debtorName: debt.debtorName || user.name,
    debtorEmail: user.email,
    status: Number(debt.outstandingAmount) > 0 ? "active" : "paid",
    agreementStatus: "accepted",
  };
}

module.exports = { pendingCounterpartyRole, isPendingInvitee, isPendingInviteCreator, debtCancellationMode, acceptInviteParticipant };
