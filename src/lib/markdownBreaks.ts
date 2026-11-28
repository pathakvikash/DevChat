interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** A remark step: a soft line break inside a paragraph becomes a break node, so a message keeps its lines without
 *  CSS `pre-line` (which also showed the newline that follows a hard break as a blank line). Code is untouched: it is not text. */
export function remarkSoftBreaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !child.value?.includes("\n")) {
        walk(child);
        return [child];
      }
      return child.value.split("\n").flatMap((part, i): MdNode[] => [...(i ? [{ type: "break" }] : []), ...(part ? [{ type: "text", value: part }] : [])]);
    });
  };
  return (tree: MdNode) => walk(tree);
}
