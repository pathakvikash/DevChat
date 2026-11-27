export default function DataTable({ headers, rows, truncated = 0 }: { headers: string[]; rows: string[][]; truncated?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 border-b border-[var(--glass-border)] text-zinc-400 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 border-b border-[var(--glass-border)] text-zinc-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated > 0 && <p className="text-xs text-zinc-500 mt-1">…{truncated} more rows not shown.</p>}
    </div>
  );
}
