"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Edge from "@/components/journal/Edge";
import { useJournal } from "../../JournalContext";

function EdgeWithTab() {
  // `closed` only. Every table here reports what a group of trades earned, and
  // an open position has not earned anything yet — folding an unrealised R into
  // "what this setup pays" would make the answer move on a quote refresh.
  const { closed, accountSize } = useJournal();
  /* Which tab, from the address — see the note on dimFromUrl in Edge. */
  const dim = useSearchParams().get("dim");
  return <Edge closed={closed} accountSize={accountSize} dimFromUrl={dim} />;
}

export default function EdgePage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of
  // static rendering — the same arrangement as the trades page.
  return (
    <Suspense fallback={null}>
      <EdgeWithTab />
    </Suspense>
  );
}
