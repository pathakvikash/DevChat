import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { url } = req.body;

  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const response = await axios.get(url);
      res
        .status(200)
        .json({
          html: response.data,
          finalUrl: response.request.res.responseUrl,
        });
    } else {
      res.status(200).json({ type: 'search' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
