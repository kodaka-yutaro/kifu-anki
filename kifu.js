// 棋譜データ。from/to は [筋, 段]（例: [7,7] = ７七）。
const KIFU_LIST = [
  {
    title: "矢倉 基本の駒組み（20手）",
    moves: [
      { from:[7,7], to:[7,6], label:"▲７六歩" },
      { from:[8,3], to:[8,4], label:"△８四歩" },
      { from:[7,9], to:[6,8], label:"▲６八銀" },
      { from:[3,3], to:[3,4], label:"△３四歩" },
      { from:[6,7], to:[6,6], label:"▲６六歩" },
      { from:[7,1], to:[6,2], label:"△６二銀" },
      { from:[5,7], to:[5,6], label:"▲５六歩" },
      { from:[5,3], to:[5,4], label:"△５四歩" },
      { from:[3,9], to:[4,8], label:"▲４八銀" },
      { from:[3,1], to:[4,2], label:"△４二銀" },
      { from:[4,9], to:[5,8], label:"▲５八金右" },
      { from:[4,1], to:[3,2], label:"△３二金" },
      { from:[6,9], to:[7,8], label:"▲７八金" },
      { from:[5,1], to:[4,1], label:"△４一玉" },
      { from:[5,9], to:[6,9], label:"▲６九玉" },
      { from:[6,1], to:[5,2], label:"△５二金" },
      { from:[5,8], to:[6,7], label:"▲６七金右" },
      { from:[4,2], to:[3,3], label:"△３三銀" },
      { from:[6,8], to:[7,7], label:"▲７七銀" },
      { from:[2,2], to:[3,1], label:"△３一角" }
    ]
  },
  {
    title: "角換わり 序盤（12手）",
    moves: [
      { from:[7,7], to:[7,6], label:"▲７六歩" },
      { from:[8,3], to:[8,4], label:"△８四歩" },
      { from:[2,7], to:[2,6], label:"▲２六歩" },
      { from:[3,3], to:[3,4], label:"△３四歩" },
      { from:[8,8], to:[2,2], promote:true, label:"▲２二角成" },
      { from:[3,1], to:[2,2], label:"△同銀" },
      { from:[7,9], to:[8,8], label:"▲８八銀" },
      { from:[2,2], to:[3,3], label:"△３三銀" },
      { from:[8,8], to:[7,7], label:"▲７七銀" },
      { from:[7,1], to:[6,2], label:"△６二銀" },
      { from:[3,9], to:[3,8], label:"▲３八銀" },
      { from:[6,1], to:[5,2], label:"△５二金" }
    ]
  }
];
