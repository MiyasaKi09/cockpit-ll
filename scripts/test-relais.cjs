const assert = require('node:assert/strict')

process.env.APP_ORIGIN = 'https://cockpit.test'

function reponseVercel() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(nom, valeur) {
      this.headers[nom] = valeur
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(valeur) {
      this.body = valeur
      return this
    },
    send(valeur) {
      this.body = valeur
      return this
    },
    end() {
      return this
    },
  }
}

function requete(patch = {}) {
  return {
    method: 'GET',
    query: { url: 'https://www.boamp.fr/' },
    body: undefined,
    headers: {
      host: 'cockpit.test',
      origin: 'https://cockpit.test',
    },
    ...patch,
  }
}

;(async () => {
  const { default: handler, lireTexteLimite, suivreRedirections, urlRelaisAutorisee } =
    await import('../api/relais.js')

  assert.equal(urlRelaisAutorisee('http://www.boamp.fr/'), null)
  assert.equal(urlRelaisAutorisee('https://www.boamp.fr@127.0.0.1/'), null)
  assert.equal(urlRelaisAutorisee('https://www.boamp.fr:8443/'), null)
  assert.equal(urlRelaisAutorisee('https://www.boamp.fr/avis')?.hostname, 'www.boamp.fr')
  assert.deepEqual(await lireTexteLimite(new Response('12345'), 4), {
    texte: '1234',
    tronquee: true,
  })

  await assert.rejects(
    () =>
      suivreRedirections(
        'https://www.boamp.fr/',
        { method: 'GET' },
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://attaquant.test/interne' },
          }),
      ),
    /liste blanche/,
  )

  let appels = 0
  global.fetch = async () => {
    appels++
    return new Response('<script>localStorage.clear()</script>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const origineInterdite = reponseVercel()
  await handler(
    requete({ headers: { host: 'cockpit.test', origin: 'https://attaquant.test' } }),
    origineInterdite,
  )
  assert.equal(origineInterdite.statusCode, 403)
  assert.equal(appels, 0)

  const requeteTropGrande = reponseVercel()
  await handler(
    requete({
      method: 'POST',
      body: 'x',
      headers: {
        host: 'cockpit.test',
        origin: 'https://cockpit.test',
        'content-length': String(512 * 1024 + 1),
      },
    }),
    requeteTropGrande,
  )
  assert.equal(requeteTropGrande.statusCode, 413)
  assert.equal(appels, 0)

  const autorisee = reponseVercel()
  await handler(requete(), autorisee)
  assert.equal(autorisee.statusCode, 200)
  assert.equal(autorisee.body, '<script>localStorage.clear()</script>')
  assert.equal(autorisee.headers['Access-Control-Allow-Origin'], 'https://cockpit.test')
  assert.equal(autorisee.headers['Content-Type'], 'text/plain; charset=utf-8')
  assert.equal(autorisee.headers['Content-Disposition'], 'attachment; filename="relais.txt"')
  assert.match(autorisee.headers['Content-Security-Policy'], /sandbox/)
  assert.equal(autorisee.headers['Cache-Control'], 'no-store')
  assert.equal(appels, 1)

  global.fetch = async () => {
    appels++
    return new Response('x'.repeat(3 * 1024 * 1024 + 1), { status: 200 })
  }
  const distanteTropGrande = reponseVercel()
  await handler(requete(), distanteTropGrande)
  assert.equal(distanteTropGrande.statusCode, 502)
  assert.match(distanteTropGrande.body.erreur, /plus de 3 Mo/)
  assert.equal(appels, 2)

  console.log(
    'OK — relais protégé : HTTPS, liste blanche, redirections, origine, tailles et contenu actif contrôlés.',
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
