import axios from 'axios';
import cors from 'cors';

const corsMiddleware = cors({
  origin: 'https://nimblebox.ai.rcd.dev-djfbjdfbsbhdfjbhjbf',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept'],
});

const baseUrl = `${process.env.BASEURL}`;

export default async function handler(req, res) {
  // The CORS middleware is automatically applied to the response headers
  // by Next.js, so you don't need to call it manually
  if (req.method === 'POST') {
    const { message } = req.body;

    try {
      const response = await axios.post(baseUrl, {
        prompt: message,
      });

      res.status(200).json({
        message: response.data.choices[0].text,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: 'An error occurred while fetching data.',
      });
    }
  } else {
    res.status(405).end(); // Method not allowed
  }
}
