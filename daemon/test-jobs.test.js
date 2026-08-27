// Tests del supervisor persistente de delegaciones (DelegationManager).
// Usa ficheros temporales; no toca ~/.hermes ni el daemon.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DelegationManager, reconciliarJobs, podarJobs, ESTADOS_TERMINALES } = require('./jobs.js')

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hv-jobs-')), n)

/* ── Reconciliación al arranque ── */

test('marca como interrupted los jobs que quedaron sin terminar', () => {
  const rows = [
    { jobId: 'a', estado: 'running' },
    { jobId: 'b', estado: 'queued' },
    { jobId: 'c', estado: 'completed' },
  ]
  const out = reconciliarJobs(rows, 1000)
  assert.strictEqual(out.find(j => j.jobId === 'a').estado, 'interrupted')
  assert.strictEqual(out.find(j => j.jobId === 'b').estado, 'interrupted')
  assert.strictEqual(out.find(j => j.jobId === 'c').estado, 'completed')
})

test('la reconciliación deja rastro del motivo y cierra el job', () => {
  const [job] = reconciliarJobs([{ jobId: 'a', estado: 'running' }], 1000)
  assert.match(job.error, /reinici/i)
  assert.strictEqual(job.finishedAt, 1000)
})

test('no reabre ni altera jobs ya terminales', () => {
  for (const estado of ESTADOS_TERMINALES) {
    const [job] = reconciliarJobs([{ jobId: 'a', estado, error: 'original' }], 1000)
    assert.strictEqual(job.estado, estado)
    assert.strictEqual(job.error, 'original')
  }
})

/* ── Poda ── */

test('poda conserva los más recientes por createdAt', () => {
  const rows = [1, 2, 3, 4, 5].map(n => ({ jobId: 's' + n, createdAt: n, estado: 'completed' }))
  const out = podarJobs(rows, 3)
  assert.deepStrictEqual(out.map(j => j.jobId), ['s3', 's4', 's5'])
})

test('poda no descarta jobs vivos aunque sean viejos', () => {
  const rows = [
    { jobId: 'viejo-vivo', createdAt: 1, estado: 'running' },
    { jobId: 'n2', createdAt: 2, estado: 'completed' },
    { jobId: 'n3', createdAt: 3, estado: 'completed' },
  ]
  const out = podarJobs(rows, 2)
  assert.ok(out.some(j => j.jobId === 'viejo-vivo'))
})

/* ── Persistencia entre reinicios ── */

test('un job creado sobrevive a recrear el manager sobre el mismo fichero', () => {
  const file = tmp('jobs.json')
  const a = new DelegationManager({ file })
  a.crear({ jobId: 'j1', sesionId: 's1', pedido: 'hola', estado: 'queued' })
  a.actualizar('j1', { estado: 'completed', resultado: 'ok' })

  const b = new DelegationManager({ file })
  const job = b.obtener('j1')
  assert.strictEqual(job.estado, 'completed')
  assert.strictEqual(job.resultado, 'ok')
})

test('al reabrir, un job que quedó running pasa a interrupted', () => {
  const file = tmp('jobs.json')
  new DelegationManager({ file }).crear({ jobId: 'j1', sesionId: 's1', estado: 'running' })
  const b = new DelegationManager({ file })
  assert.strictEqual(b.obtener('j1').estado, 'interrupted')
})

test('la reconciliación se persiste: no se repite en el siguiente arranque', () => {
  const file = tmp('jobs.json')
  new DelegationManager({ file }).crear({ jobId: 'j1', sesionId: 's1', estado: 'running' })
  const b = new DelegationManager({ file })
  const cerradoEn = b.obtener('j1').finishedAt
  const c = new DelegationManager({ file })
  assert.strictEqual(c.obtener('j1').finishedAt, cerradoEn)
})

test('listar filtra por sesión', () => {
  const m = new DelegationManager({ file: tmp('jobs.json') })
  m.crear({ jobId: 'a', sesionId: 's1', estado: 'queued' })
  m.crear({ jobId: 'b', sesionId: 's2', estado: 'queued' })
  assert.deepStrictEqual(m.listar('s1').map(j => j.jobId), ['a'])
  assert.strictEqual(m.listar().length, 2)
})

test('actualizar notifica a los suscriptores con el job completo', () => {
  const m = new DelegationManager({ file: tmp('jobs.json') })
  const vistos = []
  m.onCambio(j => vistos.push(j))
  m.crear({ jobId: 'a', sesionId: 's1', pedido: 'hola', estado: 'queued' })
  m.actualizar('a', { estado: 'running' })
  assert.strictEqual(vistos.at(-1).estado, 'running')
  assert.strictEqual(vistos.at(-1).pedido, 'hola')
  assert.strictEqual(vistos.at(-1).sesionId, 's1')
})

test('actualizar un job inexistente devuelve null y no lanza', () => {
  const m = new DelegationManager({ file: tmp('jobs.json') })
  assert.strictEqual(m.actualizar('no-existe', { estado: 'completed' }), null)
})

test('un fichero corrupto no impide arrancar', () => {
  const file = tmp('jobs.json')
  fs.writeFileSync(file, '{{{ no es json')
  const m = new DelegationManager({ file })
  assert.deepStrictEqual(m.listar(), [])
  m.crear({ jobId: 'a', sesionId: 's1', estado: 'queued' })
  assert.strictEqual(m.listar().length, 1)
})

test('registra la ruta de trabajo de la sesión en el job', () => {
  const m = new DelegationManager({ file: tmp('jobs.json') })
  const job = m.crear({ jobId: 'a', sesionId: 's1', estado: 'queued', workingDir: '/tmp/proyecto' })
  assert.strictEqual(job.workingDir, '/tmp/proyecto')
  assert.strictEqual(m.obtener('a').workingDir, '/tmp/proyecto')
})

test('cancelled es terminal: la reconciliación no lo reabre', () => {
  assert.ok(ESTADOS_TERMINALES.includes('cancelled'))
  const [job] = reconciliarJobs([{ jobId: 'a', estado: 'cancelled', error: 'barge-in' }], 1000)
  assert.strictEqual(job.estado, 'cancelled')
  assert.strictEqual(job.error, 'barge-in')
})

/* ── El evento de creación no debe adelantarse a tool.start ── */
// Visto en la captura del WS: `delegation.status queued` llegaba ANTES de
// `tool.start`, así que la UI recibía el estado de una tarjeta que todavía no
// existía y lo pintaba sobre la anterior.

test('crear no notifica: quien lanza decide cuándo anunciarlo', () => {
  const m = new DelegationManager({ file: tmp('jobs.json') })
  const vistos = []
  m.onCambio(j => vistos.push(j))
  m.crear({ jobId: 'a', sesionId: 's1', estado: 'queued' })
  assert.strictEqual(vistos.length, 0, 'la creación no emite')
  m.actualizar('a', { estado: 'running' })
  assert.strictEqual(vistos.length, 1, 'los cambios sí emiten')
})

test('el job devuelto por crear sigue siendo el estado inicial completo', () => {
  const m = new DelegationManager({ file: tmp('jobs.json') })
  const job = m.crear({ jobId: 'a', sesionId: 's1', pedido: 'hola' })
  assert.strictEqual(job.estado, 'queued')
  assert.strictEqual(job.pedido, 'hola')
})
