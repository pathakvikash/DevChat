import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await axios.get(url, {
      responseType: 'text',
    });

    res.setHeader('Content-Type', 'text/css');
    res.status(200).send(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch CSS' });
  }
}
