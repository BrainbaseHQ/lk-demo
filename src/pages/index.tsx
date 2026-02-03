import dynamic from "next/dynamic";
import Head from "next/head";
import { useState, useEffect } from "react";

const VoiceOrb = dynamic(() => import("@/components/VoiceOrb"), {
  ssr: false,
});

export default function Home() {
  return (
    <>
      <Head>
        <title>Voice Agent</title>
      </Head>
      <VoiceOrb />
    </>
  );
}
