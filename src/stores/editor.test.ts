import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "./editor";

function setup() {
  useEditor.getState().init({
    projectName: "test",
    audioPath: "/tmp/a.wav",
    duration: 30,
    sentences: [
      { id: "a", start: 1, end: 3, text: "one" },
      { id: "b", start: 5, end: 7, text: "two" },
      { id: "c", start: 9, end: 11, text: "three" },
    ],
  });
}

describe("editor store", () => {
  beforeEach(setup);

  it("init sorts sentences by start time", () => {
    useEditor.getState().init({
      projectName: "t",
      audioPath: "x",
      duration: 10,
      sentences: [
        { id: "c", start: 9, end: 11, text: "c" },
        { id: "a", start: 1, end: 3, text: "a" },
      ],
    });
    expect(useEditor.getState().sentences.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("updateSentence records history; undo/redo round-trips", () => {
    const byId = () => useEditor.getState().sentences.find((s) => s.id === "a")!.text;

    useEditor.getState().updateSentence("a", { text: "ONE" });
    expect(byId()).toBe("ONE");

    useEditor.getState().undo();
    expect(byId()).toBe("one");

    useEditor.getState().redo();
    expect(byId()).toBe("ONE");
  });

  it("deleteSentences removes and clears selection", () => {
    const st = useEditor.getState();
    st.selectOnly("b");
    st.deleteSentences(["b"]);

    const s = useEditor.getState();
    expect(s.sentences.map((x) => x.id)).toEqual(["a", "c"]);
    expect(s.activeId).toBeNull();
  });

  it("mergeSelected merges consecutive selected sentences", () => {
    const st = useEditor.getState();
    st.selectOnly("a");
    st.toggleSelect("b");
    st.mergeSelected();

    const s = useEditor.getState();
    expect(s.sentences.length).toBe(2);
    expect(s.sentences[0].start).toBe(1);
    expect(s.sentences[0].end).toBe(7);
    expect(s.sentences[0].text).toBe("one two");
  });

  it("splitSentence replaces one sentence with two", () => {
    useEditor
      .getState()
      .splitSentence("a", { start: 1, end: 2, text: "o" }, { start: 2, end: 3, text: "ne" });

    const s = useEditor.getState();
    expect(s.sentences.length).toBe(4);
    expect(s.sentences[0].text).toBe("o");
    expect(s.sentences[1].text).toBe("ne");
  });

  it("addSentence keeps list sorted", () => {
    useEditor.getState().addSentence({ start: 4, end: 5, text: "mid" });
    expect(useEditor.getState().sentences.map((s) => s.start)).toEqual([1, 4, 5, 9]);
  });

  it("marks dirty on mutation and clean after markClean", () => {
    expect(useEditor.getState().dirty).toBe(false);
    useEditor.getState().updateSentence("a", { text: "changed" });
    expect(useEditor.getState().dirty).toBe(true);
    useEditor.getState().markClean();
    expect(useEditor.getState().dirty).toBe(false);
  });
});
