const screen = require("neo-blessed/lib/widgets/screen");
const box = require("neo-blessed/lib/widgets/box");
const list = require("neo-blessed/lib/widgets/list");
const loading = require("neo-blessed/lib/widgets/loading");
const message = require("neo-blessed/lib/widgets/message");
const prompt = require("neo-blessed/lib/widgets/prompt");
const text = require("neo-blessed/lib/widgets/text");
const textbox = require("neo-blessed/lib/widgets/textbox");

const blessed = {
  screen,
  box,
  list,
  loading,
  message,
  prompt,
  text,
  textbox,
};

export default blessed;
