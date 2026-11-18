export function nextSeat(table, from, filter) {
  for (let step = 1; step <= table.players.length; step++) {
    const seat = (from + step) % table.players.length;
    if (filter(table.players[seat])) return seat;
  }
  return -1;
}


