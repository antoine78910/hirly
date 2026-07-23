const TAG_COLORS = {
  yellow: "border-yellow-200 bg-yellow-50 text-yellow-900",
  blue: "border-sky-200 bg-sky-50 text-sky-900",
  pink: "border-pink-200 bg-pink-50 text-pink-900",
  purple: "border-violet-200 bg-violet-50 text-violet-900",
};

function TableCellContent({ cell }) {
  if (cell == null || cell === "") {
    return <span className="text-zinc-300">—</span>;
  }

  if (typeof cell === "string") {
    return (
      <div className="space-y-1 text-sm leading-relaxed text-zinc-700">
        {cell.split("\n").map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    );
  }

  if (cell?.type === "label") {
    return <span className="text-sm font-semibold text-zinc-900">{cell.text}</span>;
  }

  if (cell?.type === "tag") {
    const palette = TAG_COLORS[cell.color] || TAG_COLORS.yellow;
    return (
      <span
        className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${palette}`}
      >
        {cell.text}
      </span>
    );
  }

  if (Array.isArray(cell)) {
    if (cell.length && typeof cell[0] === "string") {
      return (
        <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-zinc-700">
          {cell.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {cell.map((item, _index) => (
          <TableCellContent key={JSON.stringify(item)} cell={item} />
        ))}
      </div>
    );
  }

  return null;
}

export default function TrainingDocTable({ block }) {
  const columns = block.columns || [];
  const rows = block.rows || [];

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50">
            {columns.map((column) => (
              <th
                key={column}
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500"
              >
                {column || " "}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, _rowIndex) => (
            <tr
              key={JSON.stringify(row)}
              className="border-b border-zinc-100 align-top last:border-b-0"
            >
              {row.map((cell, _cellIndex) => (
                <td key={JSON.stringify(cell)} className="px-4 py-3 align-top">
                  <TableCellContent cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
