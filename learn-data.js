// Content for the Learn tab. Everything here is written for this app.
//
// Every example position has a `fen` and the winning `move` (from-to, plus a
// promotion letter if needed). The test suite plays each one and checks that
// the move is legal and that the coach recognises the tactic it's meant to show
// (`expect` names the fact the coach must find).
//
// `kid` is the simple version, `adult` the version with proper terms.

export const TACTICS = [
  {
    id: "fork", name: "Fork",
    kid: "One piece attacks two things at once, so your opponent can only save one!",
    adult: "A single piece (often a knight or pawn) attacks two or more targets simultaneously; the opponent can only address one.",
    tip: "Knights are the best forkers because nobody can block their jumps. Before you move, check which squares an enemy knight could jump to.",
    example: { fen: "3q3k/8/8/6N1/8/8/8/4K3 w - - 0 1", move: "g5f7", expect: "fork", caption: "The knight jumps to f7 and attacks the king and the queen. Black must save the king, so the queen is lost." },
  },
  {
    id: "pawn-fork", name: "Pawn fork",
    kid: "A tiny pawn can fork too — and it wins a bigger piece every time!",
    adult: "A pawn advance attacks two pieces at once. Because a pawn is worth so little, the forked pieces can't punish it.",
    tip: "Look for squares where your pawn would attack two enemy pieces, and check the pawn is safe there.",
    example: { fen: "4k3/8/8/2n1b3/8/3P4/8/4K3 w - - 0 1", move: "d3d4", expect: "fork", caption: "The pawn steps to d4 and attacks the knight and the bishop. One of them will be captured." },
  },
  {
    id: "pin", name: "Pin",
    kid: "A piece is stuck because moving it would let you attack something more important behind it.",
    adult: "A piece cannot (or should not) move because it shields a more valuable piece — often the king — from an attack by a bishop, rook or queen.",
    tip: "Pins to the king are absolute: the pinned piece truly can't move. Add more attackers to the pinned piece to win it.",
    example: { fen: "4k3/8/2n5/8/8/8/4B3/4K3 w - - 0 1", move: "e2b5", expect: "pin", caption: "The bishop pins the knight to the king. If the knight moves, the king would be in check — which is illegal." },
  },
  {
    id: "skewer", name: "Skewer",
    kid: "Like a pin backwards: the valuable piece in front must run away, and then you capture the one behind it.",
    adult: "An attack on a valuable piece that, when it moves, exposes a lesser piece behind it to capture.",
    tip: "Skewers happen on long lines: look for kings and queens that line up on the same rank, file or diagonal.",
    example: { fen: "4k2q/8/8/8/8/8/8/R3K3 w - - 0 1", move: "a1a8", expect: "skewer", caption: "The rook checks the king. When the king steps aside, the rook takes the queen on h8." },
  },
  {
    id: "discovered-attack", name: "Discovered attack",
    kid: "You move one piece out of the way, and a piece hiding behind it suddenly attacks!",
    adult: "Moving a piece uncovers an attack by a rook, bishop or queen behind it — and the moved piece can make its own threat at the same time.",
    tip: "The moving piece is free to do something strong, because the opponent has to deal with the uncovered attack.",
    example: { fen: "3qk3/8/8/8/3N4/8/8/3RK3 w - - 0 1", move: "d4b5", expect: "discovered", caption: "The knight steps away and the rook on d1 now attacks the queen on d8." },
  },
  {
    id: "discovered-check", name: "Discovered check",
    kid: "Move a piece and, surprise — a different piece gives check! The moved piece can then grab something.",
    adult: "A discovered attack on the king. The opponent must answer the check, so the moving piece gets a free hit.",
    tip: "A discovered check is one of the strongest tactical weapons because the moving piece can take almost anything.",
    example: { fen: "4k3/8/8/8/4N3/7q/8/4R1K1 w - - 0 1", move: "e4g5", expect: "discoveredCheck", caption: "The knight uncovers the rook's check on the king and also attacks the queen on h3." },
  },
  {
    id: "double-check", name: "Double check",
    kid: "Two pieces check the king at the same time. The king has to move — nothing else will work!",
    adult: "Two pieces give check simultaneously; blocking or capturing can only deal with one, so the king must move.",
    tip: "A double check can win even against a well-protected king.",
    example: { fen: "4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1", move: "e4d6", expect: "doubleCheck", caption: "The knight gives check from d6 and uncovers the rook's check along the e-file. The king has to run." },
  },
  {
    id: "zwischenzug", name: "Zwischenzug (in-between move)",
    kid: "Instead of the obvious reply, you sneak in a surprise move first — and it changes everything.",
    adult: "An intermediate move, often a check or a bigger threat, played before making the expected recapture or response.",
    tip: "When your opponent captures something, ask: is there a check or a bigger threat I can play before recapturing?",
  },
  {
    id: "desperado", name: "Desperado",
    kid: "A piece that's going to be lost anyway grabs as much as it can on its way out.",
    adult: "A piece that is already doomed captures material or gives check before it is taken.",
    tip: "If one of your pieces is trapped, look for the most valuable thing it can capture before it falls.",
  },
  {
    id: "deflection", name: "Deflection",
    kid: "You tempt a defender to go away from its job, and then take what it was guarding.",
    adult: "Forcing a defending piece away from a key square or duty, usually with a sacrifice or a threat.",
    tip: "Ask: which piece is protecting the thing I want to attack? Can I force it to leave?",
  },
  {
    id: "decoy", name: "Decoy",
    kid: "You lure a piece — often the king or queen — onto a square where it gets into trouble.",
    adult: "Dragging an enemy piece to a bad square, typically by offering a sacrifice, so it can be attacked or checkmated.",
    tip: "Decoys often end in a fork or a checkmate, so look at where the lured piece will land.",
  },
  {
    id: "overloading", name: "Overloading",
    kid: "One piece has too many jobs. When it does one job, it has to drop the other!",
    adult: "A defender is responsible for protecting two things at once; attacking one of them leaves the other undefended.",
    tip: "Look for enemy pieces that protect two squares or two pieces at the same time.",
  },
  {
    id: "remove-defender", name: "Removing the defender",
    kid: "Take the piece that is protecting something, and then take the thing it was protecting.",
    adult: "Capturing or driving off a defending piece so the piece it guarded falls.",
    tip: "Trade off the defender, then win the target — it only works if the trade is at least even.",
  },
  {
    id: "interference", name: "Interference",
    kid: "You put a piece in between two enemy pieces that were helping each other, cutting them apart.",
    adult: "Placing a piece on a line between two enemy pieces so that their coordination is broken.",
    tip: "Great for cutting a defender off from the piece it was protecting.",
  },
  {
    id: "x-ray", name: "X-ray",
    kid: "A piece \"sees\" through another piece, so it still matters even when something is in the way.",
    adult: "A piece exerts influence along a line through an enemy piece, so that after the intervening piece moves or is exchanged, the x-ray becomes a real attack.",
    tip: "X-rays decide many endgames, when rooks look at each other through their own pieces.",
  },
  {
    id: "sacrifice", name: "Sacrifice",
    kid: "You give up a piece on purpose to get something even bigger — like checkmate or a stronger piece.",
    adult: "Deliberately giving up material for compensation: an attack, a decisive tactic, or a lasting positional advantage.",
    tip: "Before sacrificing, count carefully: what do you get, and can your opponent simply decline?",
  },
  {
    id: "en-passant", name: "En passant",
    kid: "A special pawn capture: if an enemy pawn jumps two squares past yours, you may take it as if it had moved one.",
    adult: "A pawn that has just advanced two squares can be captured by an adjacent enemy pawn as though it had advanced one — but only on the very next move.",
    tip: "It's the only capture where you don't land on the piece you take. Remember: now or never!",
    example: { fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", move: "e5d6", expect: "enPassant", caption: "Black's pawn just jumped from d7 to d5. White captures it as if it had stopped on d6." },
  },
  {
    id: "underpromotion", name: "Promotion fork (underpromotion)",
    kid: "When a pawn reaches the end it can become any piece — and sometimes a knight is better than a queen!",
    adult: "Promoting to a knight (or other minor piece) when it gives a decisive fork or avoids stalemate.",
    tip: "Always think before you click \"queen\". A knight promotion can fork the king and another piece.",
    example: { fen: "8/3q1P1k/8/8/8/8/8/K7 w - - 0 1", move: "f7f8n", expect: "fork", caption: "The pawn becomes a knight on f8 and checks the king on h7 while attacking the queen on d7." },
  },
  {
    id: "trapped-piece", name: "Trapped piece",
    kid: "A piece with no safe squares to go to can simply be won.",
    adult: "A piece whose every escape square is attacked or blocked, so it will be captured for less than its value.",
    tip: "Don't grab a pawn with your bishop or queen if the piece can be trapped afterward.",
  },
  {
    id: "zugzwang", name: "Zugzwang",
    kid: "It's your turn, and every move you can make makes things worse — you wish you could pass!",
    adult: "A position where the side to move would be better off if it could pass, because every legal move worsens its position.",
    tip: "Zugzwang is common in endgames with kings and pawns.",
  },
];

export const MATES = [
  {
    id: "back-rank", name: "Back-rank mate",
    kid: "The king is stuck behind his own pawns, and a rook or queen checks him along the back row. No escape!",
    adult: "A rook or queen gives mate along the first or eighth rank, with the king boxed in by his own pawns.",
    tip: "Give your king an escape square (a small pawn move like h3) so you're never the victim.",
    example: { fen: "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", move: "a1a8", expect: "backRankMate", caption: "The rook checks along the back rank. The king's own pawns block every escape." },
  },
  {
    id: "smothered", name: "Smothered mate",
    kid: "The king is surrounded by his own pieces, and a sneaky knight gives the final check.",
    adult: "A knight gives mate to a king whose every neighbouring square is occupied by its own pieces.",
    tip: "It often starts with a queen sacrifice that forces the rook next to the king.",
    example: { fen: "6rk/6pp/8/6N1/8/8/8/4K3 w - - 0 1", move: "g5f7", expect: "smotheredMate", caption: "The knight checks from f7. The king can't take it and has no free squares." },
  },
  {
    id: "support", name: "Queen and king mate",
    kid: "The queen gives check right next to the king, and your own king protects her so she can't be captured.",
    adult: "A queen delivers mate on a square adjacent to the enemy king, protected by the king or another piece.",
    tip: "Bring your king close in the endgame. It's a strong attacking piece when the queens are on.",
    example: { fen: "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1", move: "g1g7", expect: "mate", caption: "The queen goes to g7 right next to the king, and the white king on f6 protects her." },
  },
  {
    id: "ladder", name: "Ladder mate",
    kid: "Two rooks take turns pushing the king to the edge, like climbing a ladder.",
    adult: "Two rooks (or queen and rook) alternately cut off ranks and drive the king to the edge, where one delivers mate.",
    tip: "Keep the rooks far apart so they can't be attacked at once.",
    example: { fen: "7k/R7/8/8/8/8/8/1R2K3 w - - 0 1", move: "b1b8", expect: "mate", caption: "One rook guards the 7th rank, and the other checks on the back rank. The king is trapped." },
  },
  {
    id: "scholars", name: "Scholar's mate",
    kid: "The famous four-move trap! Don't fall for it, and don't be afraid to try it on a beginner.",
    adult: "A four-move mate that attacks f7 (or f2) with the queen and bishop. Easily defended if you know it's coming.",
    tip: "Defend f7 with ...Nf6 or ...g6 and the attack falls apart.",
    sequence: { moves: "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#", caption: "Watch White's queen and bishop team up on f7." },
  },
  {
    id: "fools", name: "Fool's mate",
    kid: "The fastest checkmate in chess: only two moves each, and it only works if White plays badly.",
    adult: "The shortest possible game: 1.f3 e5 2.g4 Qh4#, exploiting the weakened diagonal to the king.",
    tip: "Never open the diagonal from h4 to e1 with f3 and g4 pawn moves right at the start.",
    sequence: { moves: "f3 e5 g4 Qh4#", caption: "White weakens the king's diagonal and Black's queen delivers mate immediately." },
  },
];

export const PRINCIPLES = [
  { name: "1. Fight for the center", text: "The four middle squares (d4, e4, d5, e5) let your pieces reach both sides of the board. Pawns on e4 and d4 are a great way to start." },
  { name: "2. Develop your pieces", text: "Bring out your knights and bishops early, and try to move each piece only once in the opening. A piece on its starting square isn't helping." },
  { name: "3. Castle early", text: "Castling puts your king behind a wall of pawns and connects your rooks. Most players castle within the first ten moves." },
  { name: "4. Don't rush your queen out", text: "A queen that comes out too early can be chased around by smaller pieces, and your opponent develops for free while you run." },
  { name: "5. Don't move the same piece twice", text: "Every move should add something new. If you can bring out a fresh piece instead, do that." },
  { name: "6. Look before you move", text: "Ask three questions every time: what did my opponent's last move do? Is anything of mine unprotected? What can they capture or check next?" },
];

export const STRATEGY = [
  { name: "Piece values", text: "Pawn = 1, knight = 3, bishop = 3, rook = 5, queen = 9. Use these to judge trades: giving a rook (5) for a knight and pawn (4) loses a little. The king can't be traded — he's priceless." },
  { name: "Check, capture, threat", text: "A great habit: before you move, list every check, capture and threat your opponent has, then list yours. Most beginner mistakes come from skipping this." },
  { name: "King safety", text: "Keep pawns in front of your castled king. Moving them (especially f, g and h pawns) creates holes for enemy pieces." },
  { name: "Open files and rooks", text: "Rooks love open files — columns with no pawns. Put them there, ideally behind a passed pawn or aimed at the enemy king." },
  { name: "Good and bad bishops", text: "A bishop blocked by your own pawns on the same color is a \"bad\" bishop. Try to keep your pawns on the opposite color from your bishop." },
  { name: "Pawn structure", text: "Doubled pawns (two on one file) and isolated pawns (no friends on neighboring files) are weak. A passed pawn — no enemy pawns in front on its or neighboring files — is a powerful asset." },
  { name: "Outposts", text: "A square deep in enemy territory that can't be attacked by enemy pawns is a perfect home for a knight." },
  { name: "When you're ahead, trade", text: "If you've won material, trade pieces (not pawns). Fewer pieces means fewer ways for your opponent to fight back." },
  { name: "Learn from the champions", text: "Garry Kasparov was famous for deep opening preparation and dynamic, attacking play — he favoured sharp openings like the Sicilian Najdorf and King's Indian. Magnus Carlsen is known for patiently squeezing small advantages and for brilliant endgame technique, often using flexible openings. Try both styles: attack when your pieces are active, squeeze when the position is quiet." },
];

export const ENDGAMES = [
  {
    name: "Opposition",
    text: "Kings can never touch, so when they face each other with one square between them, the player who must move has to give way. Having the opposition (the other side to move) often decides king-and-pawn endings.",
    fen: "8/8/4k3/8/4K3/8/8/8 w - - 0 1",
    caption: "The kings face each other. Whoever has to move must step aside — so having the move is a disadvantage here.",
  },
  {
    name: "Use your king",
    text: "In the endgame there's less danger of checkmate, so the king becomes a strong fighter. Bring it to the center and use it to support your pawns and attack theirs.",
  },
  {
    name: "Passed pawns must be pushed",
    text: "A passed pawn that has no enemy pawns blocking its path is the most dangerous piece in an endgame. Support it with your king and rook, and stop the enemy's passed pawn the same way.",
  },
  {
    name: "Queen and king mate",
    text: "With a queen and king against a lone king, drive the enemy king to the edge with the queen at a knight's-move distance, bring your king close, and finish with a protected check — beware of stalemate!",
    fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
    caption: "Black has no move to escape: White just needs to play Qg7 — protected by the king — for checkmate.",
    move: "f7g7",
  },
  {
    name: "Rook endgames",
    text: "Rook endings are the most common endgames. Two famous ideas: keep your rook behind a passed pawn (yours or theirs), and in rook-and-pawn against rook, try to build a \"bridge\" to shield your king from checks (the Lucena position).",
  },
];

export const GLOSSARY = [
  ["Check", "A direct attack on the king. You must get out of it immediately."],
  ["Checkmate", "The king is in check and can't escape. The game ends."],
  ["Stalemate", "It's your turn, you're not in check, but you have no legal move. The game is a draw."],
  ["Castling", "A special move: the king goes two squares toward a rook and the rook hops over to the other side."],
  ["Rank / File / Diagonal", "Rows are ranks (1–8), columns are files (a–h), and diagonals run corner to corner."],
  ["Material", "The pieces each side has. \"Up material\" means you've captured more than your opponent."],
  ["Tempo", "One move's worth of time. Gaining a tempo means making progress while your opponent loses a move."],
  ["Initiative", "Having the upper hand: your opponent must keep responding to your threats."],
  ["Gambit", "An opening where you offer a pawn on purpose to gain speed or position."],
  ["Fianchetto", "Placing a bishop on the long diagonal (b2, g2, b7 or g7) after moving the knight's pawn one square."],
  ["Outpost", "A strong square, usually for a knight, that enemy pawns can't attack."],
  ["Open file", "A column with no pawns on it. Rooks like open files."],
  ["Passed pawn", "A pawn with no enemy pawns blocking its path or able to capture it on the way to promotion."],
  ["Blunder", "A big mistake that loses material or the game."],
  ["Zugzwang", "A position where any move you make makes things worse."],
  ["Book move", "A move found in opening theory — one that strong players have tested many times."],
  ["Hanging piece", "A piece that is attacked and not protected, so it can be captured for free."],
  ["Fork / Pin / Skewer", "Three of the most common tactics — see the Tactics section."],
  ["Promotion", "A pawn that reaches the far end becomes a queen, rook, bishop or knight."],
  ["Draw", "A game that ends without a winner: stalemate, repetition, insufficient material or agreement."],
];

// Famous games. Each `moves` list is checked move by move in the tests. The
// notes are keyed by ply (1 = White's first move).
export const GAMES = [
  {
    id: "opera", title: "The Opera Game", players: "Paul Morphy vs. the Duke of Brunswick and Count Isouard", year: "1858",
    why: "A beautiful teaching game: Morphy develops quickly, sacrifices a knight to open lines, and mates in 17 moves.",
    moves: "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#",
    result: "1-0",
    notes: { 4: "Black's d6 blocks his own bishop a little — a quiet but slightly passive move.", 6: "The bishop pins the knight on f3 to the queen.", 9: "White takes back with the queen, keeping the initiative.", 17: "Bg5 attacks the queen's knight, which is guarding the d-file. Morphy keeps developing while Black drifts.", 19: "Nxb5!? is the key sacrifice — it rips open Black's king position.", 23: "Castling long puts the rook on the d-file with a threat.", 25: "Rxd7 removes a key defender and keeps the pressure on.", 31: "Qb8+ is a queen sacrifice that forces the knight away from the defence.", 33: "Rd8# — checkmate with a single rook." },
  },
  {
    id: "immortal", title: "The Immortal Game", players: "Adolf Anderssen vs. Lionel Kieseritzky", year: "1851",
    why: "Anderssen gave up a bishop, both rooks and even the queen — and still checkmated with his remaining minor pieces.",
    moves: "e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 h4 Qg6 h5 Qg5 Qf3 Ng8 Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 Qf6+ Nxf6 Be7#",
    result: "1-0",
    notes: { 3: "The King's Gambit: White offers a pawn for fast development.", 5: "The bishop eyes f7.", 15: "White keeps attacking and ignores his weakened king.", 21: "Rg1 prepares to open the g-file, even at the cost of a rook.", 35: "Bd6!? is the start of the finale: White keeps giving up material to hunt the king.", 43: "Qf6+! — White sacrifices his queen.", 45: "Be7 is checkmate, delivered by a humble bishop." },
  },
  {
    id: "kasparov-topalov", title: "Kasparov's Immortal", players: "Garry Kasparov vs. Veselin Topalov", year: "1999",
    why: "One of the greatest attacking games ever: a rook sacrifice on move 24 starts a king hunt across the whole board.",
    moves: "e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5 Nge2 Nbd7 Bh6 Bxh6 Qxh6 Bb7 a3 e5 O-O-O Qe7 Kb1 a6 Nc1 O-O-O Nb3 exd4 Rxd4 c5 Rd1 Nb6 g3 Kb8 Na5 Ba8 Bh3 d5 Qf4+ Ka7 Rhe1 d4 Nd5 Nbxd5 exd5 Qd6 Rxd4 cxd4 Re7+ Kb6 Qxd4+ Kxa5 b4+ Ka4 Qc3 Qxd5 Ra7 Bb7 Rxb7 Qc4 Qxf6 Kxa3 Qxa6+ Kxb4 c3+ Kxc3 Qa1+ Kd2 Qb2+ Kd1 Bf1 Rd2 Rd7 Rxd7 Bxc4 bxc4 Qxh8 Rd3 Qa8 c3 Qa4+ Ke1 f4 f5 Kc1 Rd2 Qa7",
    result: "1-0",
    notes: { 47: "Rxd4!! — the rook is given up so Kasparov's pieces can burst into the black king.", 49: "Re7+ — the rook sacrifices itself again.", 51: "Qxd4+ — the king hunt is on: Black's king is dragged toward the open." },
  },
  {
    id: "deep-blue", title: "Kasparov vs. Deep Blue, Game 6", players: "Garry Kasparov vs. Deep Blue", year: "1997",
    why: "The decisive game of the famous match in which a computer beat the world champion. Kasparov lost in only 19 moves.",
    moves: "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Ng5 Ngf6 Bd3 e6 N1f3 h6 Nxe6 Qe7 O-O fxe6 Bg6+ Kd8 Bf4 b5 a4 Bb7 Re1 Nd5 Bg3 Kc8 axb5 cxb5 Qd3 Bc6 Bf5 exf5 Rxe7 Bxe7 c4",
    result: "1-0",
    notes: { 14: "...h6 is a known mistake — it invites a powerful knight sacrifice.", 15: "Nxe6! sacrifices a knight to wreck Black's king position.", 19: "Bg6+ keeps the king stuck in the center." },
  },
];
