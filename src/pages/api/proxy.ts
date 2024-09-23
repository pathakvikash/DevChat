import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { JSDOM } from 'jsdom';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await axios.get(url);
    const dom = new JSDOM(response.data);
    const document = dom.window.document;

    // Modify all links and resource URLs to use the proxy
    document.querySelectorAll('a, link, script, img').forEach((el: any) => {
      const attr = el.tagName === 'A' ? 'href' : 'src';
      if (el[attr] && !el[attr].startsWith('data:')) {
        el[attr] = `/api/proxy?url=${encodeURIComponent(
          new URL(el[attr], url).href
        )}`;
      }
    });

    // Remove any existing Content Security Policy
    document
      .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
      .forEach((el) => el.remove());

    const modifiedHtml = dom.serialize();
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(modifiedHtml);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch the page' });
  }
}
