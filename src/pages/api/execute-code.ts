import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.body;

  const command = `python3 -c '${code.replace(/'/g, "'\\''")}'`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ error: error.message });
    } else if (stderr) {
      res.status(400).json({ error: stderr });
    } else {
      res.status(200).json({ output: stdout });
    }
  });
}
