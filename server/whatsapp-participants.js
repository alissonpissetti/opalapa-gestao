export async function getParticipanteIdForArrecadacao(pool, arrecadacaoId) {
  const [rows] = await pool.query(
    `SELECT participante_id FROM arrecadacao WHERE id = ? LIMIT 1`,
    [arrecadacaoId],
  );
  return rows[0]?.participante_id ? Number(rows[0].participante_id) : null;
}
