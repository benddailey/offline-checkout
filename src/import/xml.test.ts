import { expect, test } from "vite-plus/test";
import { scanXml } from "./xml";

function events(xml: string): string[] {
  const out: string[] = [];
  scanXml(xml, {
    open: (name, attrs) => out.push(`open ${name} ${JSON.stringify(attrs)}`),
    text: (value) => out.push(`text ${value}`),
    close: (name) => out.push(`close ${name}`),
  });
  return out;
}

test("handles prefixes, either quote style, self-closing tags and entities", () => {
  expect(
    events(`<x:a r:id='1' b="2"><x:b/><c>&lt;&amp;&gt;&quot;&apos;&#65;&#x42;&amp;lt;</c></x:a>`),
  ).toEqual([
    'open a {"id":"1","b":"2"}',
    "open b {}",
    "close b",
    "open c {}",
    `text <&>"'AB&lt;`,
    "close c",
    "close a",
  ]);
});

test("skips comments, processing instructions and the declaration", () => {
  expect(events(`<?xml version="1.0"?><!-- <fake> --><a><?pi x?>hi<!-- c --></a>`)).toEqual([
    "open a {}",
    "text hi",
    "close a",
  ]);
});

test("keeps a > inside an attribute value", () => {
  expect(events(`<a t="x>y"/>`)).toEqual(['open a {"t":"x>y"}', "close a"]);
});
