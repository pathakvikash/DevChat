import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
// @json-render/core's peer dependency is Zod v4; DevChat's app-wide `zod` is
// pinned to v3 (used throughout src/lib/registry/*). Use the aliased v4
// copy here only, so the two majors never mix in the same schema instance.
import { z } from "zod4";

export const catalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({
        title: z.string(),
        subtitle: z.string().nullable(),
      }),
      description: "A card container with an optional subtitle. Use to group related content.",
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
      }),
      description: "A heading. level 1 is largest, 3 is smallest. Defaults to 2.",
    },
    Text: {
      props: z.object({
        content: z.string(),
      }),
      description: "A paragraph of plain text.",
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.union([z.literal("primary"), z.literal("secondary")]).nullable(),
      }),
      description: "A clickable button. Not wired to any action yet — purely presentational.",
    },
    List: {
      props: z.object({
        items: z.array(z.string()),
      }),
      description: "A bulleted list of short text items.",
    },
    Badge: {
      props: z.object({
        text: z.string(),
        variant: z
          .union([z.literal("default"), z.literal("success"), z.literal("warning"), z.literal("error")])
          .nullable(),
      }),
      description: "A small status label/pill, e.g. for showing a state like 'Active' or 'Failed'.",
    },
    Divider: {
      props: z.object({}),
      description: "A horizontal divider line to separate sections.",
    },
    Alert: {
      props: z.object({
        title: z.string().nullable(),
        message: z.string(),
        variant: z
          .union([z.literal("info"), z.literal("success"), z.literal("warning"), z.literal("error")])
          .nullable(),
      }),
      description: "A callout banner for important messages, warnings, or errors.",
    },
    Table: {
      props: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      description: "A simple data table. `rows` is an array of arrays, one per row, matching `headers` length.",
    },
    Link: {
      props: z.object({
        href: z.string(),
        label: z.string(),
      }),
      description: "A clickable external link, opens in a new tab. Only use for real http(s) URLs.",
    },
    Input: {
      props: z.object({
        label: z.string(),
        placeholder: z.string().nullable(),
        value: z.string().nullable(),
      }),
      description:
        "A single-line text input. Bind `value` with `{ \"$bindState\": \"/path\" }` to read/write it from state.",
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        checked: z.boolean().nullable(),
      }),
      description:
        "A checkbox. Bind `checked` with `{ \"$bindState\": \"/path\" }` to read/write it from state.",
    },
    Select: {
      props: z.object({
        label: z.string(),
        options: z.array(z.string()),
        value: z.string().nullable(),
      }),
      description:
        "A dropdown select. Bind `value` with `{ \"$bindState\": \"/path\" }` to read/write it from state.",
    },
    Chart: {
      props: z.object({
        type: z.union([z.literal("bar"), z.literal("line"), z.literal("pie")]),
        title: z.string().nullable(),
        data: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
          }),
        ),
      }),
      description:
        "A chart. Use 'bar' to compare values across categories, 'line' for a trend over an ordered sequence, 'pie' for parts of a whole. Keep data to 3-8 points for readability.",
    },
  },
  actions: {},
});

export type GenerativeUiCatalog = typeof catalog;
