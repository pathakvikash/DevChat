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
      description:
        "A clickable button. A Button with `\"on\": { \"press\": { \"action\": \"submit\" } }` sends the current values of the form inputs above it to the chat; bind each Input/Checkbox/Select with `{ \"$bindState\": \"/form/<field>\" }`. Do not pass params: the values are read from the inputs. Without `on.press` it is only decorative.",
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
        headers: z.array(z.string()).nullable(),
        rows: z.array(z.array(z.string())).nullable(),
        dataArtifactId: z.string().nullable(),
        columns: z.array(z.string()).nullable(),
      }),
      description:
        "A data table. Prefer `dataArtifactId` (id of a saved data artifact), with `columns` to show only some of its columns. Use inline `headers` + `rows` (one array per row) only for a few hand-typed values.",
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
        type: z.union([z.literal("bar"), z.literal("line"), z.literal("area"), z.literal("pie")]),
        title: z.string().nullable(),
        data: z
          .array(
            z.object({
              label: z.string(),
              value: z.number(),
            }),
          )
          .nullable(),
        dataArtifactId: z.string().nullable(),
        labelColumn: z.string().nullable(),
        valueColumn: z.string().nullable(),
        series: z
          .array(z.object({ name: z.string(), points: z.array(z.tuple([z.number(), z.number()])) }))
          .nullish(),
      }),
      description:
        "A chart. Use 'bar' to compare values across categories, 'line' for a trend over an ordered sequence, 'area' for a filled trend, 'pie' for parts of a whole. Prefer `dataArtifactId` (id of a saved data artifact) with `labelColumn`/`valueColumn` naming which of its columns to plot; use inline `data` only for a few hand-typed points. Keep to 3-8 points for readability. For a time axis with one or more series ('line' or 'area'), use `series` ([{name, points: [[epochMs, value], ...]}], at most 12 points in total inline) or, when a connected app's timeseries result gave you an artifact id, just `dataArtifactId`.",
    },
    CandleChart: {
      props: z.object({
        symbol: z.string().nullable(),
        interval: z.string().nullable(),
        dataArtifactId: z.string().nullable(),
        candles: z
          .array(
            z.object({
              t: z.number(),
              o: z.number(),
              h: z.number(),
              l: z.number(),
              c: z.number(),
              v: z.number().nullish(),
            }),
          )
          .nullish(),
      }),
      description:
        "An interactive candlestick (OHLC) chart with a volume histogram and crosshair. Use for market price history. Pass `dataArtifactId` when a connected app's ohlc result gave you an artifact id (symbol and interval are then read from it, so set them to null); `candles` ([{t: epochMs, o, h, l, c, v}]) only for a handful (at most 12) of hand-typed candles.",
    },
    Model3D: {
      props: z.object({
        appId: z.string(),
        file: z.string(),
        title: z.string().nullable(),
        openLink: z.string().nullable(),
        appName: z.string().nullable(),
      }),
      description:
        "An interactive 3D viewer (drag to rotate) for an STL model produced by a connected app, with a Download STL link. `appId` is the app's id and `file` the file id from the app's model3d result, copied exactly. `openLink` is an optional deep-link name from that app's manifest for an 'Open in app' button (null to omit). Never invent a file id.",
    },
    JobCard: {
      props: z.object({
        appId: z.string(),
        jobId: z.string(),
        statusTool: z.string(),
        title: z.string().nullable(),
        pollMs: z.number().nullable(),
      }),
      description:
        "Live progress for a long-running job started by a connected app. It polls the job's status, shows a progress bar, then renders the finished result itself (model, chart, table or link). Copy `appId`, `jobId` and `statusTool` exactly from the app's job result; pollMs is usually null (default 2000).",
    },
  },
  actions: {
    submit: {
      params: z.object({}),
      description: "Send the current values of the bound form inputs to the chat. Takes no params.",
    },
  },
});

export type GenerativeUiCatalog = typeof catalog;
