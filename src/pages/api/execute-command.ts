import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { command } = req.body;

  // Simulate command execution
  let output = '';
  switch (command.trim()) {
    case 'ls':
      output = 'file1.txt file2.txt';
      break;
    case 'date':
      output = new Date().toString();
      break;
    default:
      output = `Command not found: ${command}`;
  }

  res.status(200).json({ output });
}
