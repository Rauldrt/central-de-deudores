export default async function handler(req, res) {
  const { cuit } = req.query;

  if (!cuit || !/^\d{11}$/.test(cuit)) {
    return res.status(400).json({ errorMessages: ['CUIT inválido'] });
  }

  const url = `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/Historicas/${cuit}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(503).json({ errorMessages: ['Error al contactar al BCRA: ' + error.message] });
  }
}
