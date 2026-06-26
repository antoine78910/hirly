export function formatInviteClicked(row, fmtDate) {
  if (!row?.first_clicked_at) return "Not opened";
  const count = Number(row.click_count) || 1;
  const when = fmtDate(row.last_clicked_at || row.first_clicked_at);
  return count > 1 ? `${when} (${count} opens)` : when;
}

export function formatInviteConnectedAccount(row) {
  if (row?.redeemed_by_email) return row.redeemed_by_email;
  if (row?.redeemed_by_user_id) return row.redeemed_by_user_id;
  return "—";
}

export function formatInviteStatus(row) {
  if (row?.redeemed_at) return "Signed up";
  if (row?.first_clicked_at) return "Link opened";
  if (row?.revoked) return "Revoked";
  return "Pending";
}
