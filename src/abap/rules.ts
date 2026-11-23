/**
 * Rule catalog — thin projection over abaplint's own rule metadata, so the
 * documentation an agent reads is the analyzer's, not a copy that can drift.
 */
import * as abaplint from "@abaplint/core";

import { notFound } from "../errors.js";
import { FAE_DOCS, FAE_RULE } from "./fae.js";

export interface RuleSummary {
  key: string;
  title: string;
  shortDescription: string;
  tags: string[];
  docsUrl: string;
}

export interface RuleDetail extends RuleSummary {
  extendedInformation: string;
}

interface RuleMetadata {
  key: string;
  title: string;
  shortDescription: string;
  extendedInformation?: string;
  tags?: string[];
  badExample?: string;
  goodExample?: string;
  docsUrl?: string;
}

/** Rules abap-mcp runs itself (namespaced keys, so no abaplint key can collide). */
const OWN_RULES: RuleMetadata[] = [
  {
    key: FAE_RULE,
    title: "FOR ALL ENTRIES compares fields of different type or length",
    shortDescription:
      "A SELECT … FOR ALL ENTRIES IN itab compares a column with an itab component of a different type or length; " +
      "ABAP rejects this at activation.",
    extendedInformation:
      "ABAP requires each column compared with a FOR ALL ENTRIES component to have exactly the same type and length " +
      "(CHAR 10 against CHAR 12 fails), and abaplint does not check it, so the error otherwise appears only on the SAP " +
      "system. abap-mcp resolves the column from the table XML or CDS view in the input and the itab row from abaplint's " +
      "scope or, inside a RAP handler, from the CDS view behind READ ENTITIES … RESULT. It reports only when both sides " +
      "resolve. Fix with a range table, or copy the keys into a helper table typed like the column.",
    tags: ["SingleFile"],
    badExample:
      "SELECT match_id FROM zmatch FOR ALL ENTRIES IN @lt_award   \" match_id CHAR 10\n" +
      "  WHERE match_id = @lt_award-ref_id INTO TABLE @DATA(lt_hit). \" ref_id CHAR 12",
    goodExample:
      "DATA lt_r TYPE RANGE OF zmatch-match_id.\n" +
      "lt_r = VALUE #( FOR a IN lt_award ( sign = 'I' option = 'EQ' low = a-ref_id ) ).\n" +
      "IF lt_r IS NOT INITIAL.\n" +
      "  SELECT match_id FROM zmatch WHERE match_id IN @lt_r INTO TABLE @DATA(lt_hit).\n" +
      "ENDIF.",
    docsUrl: FAE_DOCS,
  },
];

function metadata(): RuleMetadata[] {
  return [...abaplint.ArtifactsRules.getRules().map((r) => r.getMetadata() as RuleMetadata), ...OWN_RULES];
}

function toSummary(m: RuleMetadata): RuleSummary {
  return {
    key: m.key,
    title: m.title,
    shortDescription: m.shortDescription,
    tags: m.tags ?? [],
    docsUrl: m.docsUrl ?? `https://rules.abaplint.org/${m.key}/`,
  };
}

export function listRules(query?: string, tag?: string): RuleSummary[] {
  const q = query?.toLowerCase();
  return metadata()
    .filter((m) => {
      if (tag !== undefined && !(m.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()))
        return false;
      if (q !== undefined) {
        const hay = `${m.key} ${m.title} ${m.shortDescription}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .map(toSummary)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function explainRule(key: string): RuleDetail & { badExample?: string; goodExample?: string } {
  const m = metadata().find((x) => x.key.toLowerCase() === key.toLowerCase());
  if (m === undefined) {
    throw notFound(`No abaplint rule named "${key}". Use list_abap_rules to browse valid keys.`, {
      key,
    });
  }
  const detail: RuleDetail & { badExample?: string; goodExample?: string } = {
    ...toSummary(m),
    extendedInformation: m.extendedInformation ?? "",
  };
  if (m.badExample !== undefined) detail.badExample = m.badExample;
  if (m.goodExample !== undefined) detail.goodExample = m.goodExample;
  return detail;
}
