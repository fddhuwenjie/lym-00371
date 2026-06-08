const TokenType = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  IDENT: 'IDENT',
  FUNCTION: 'FUNCTION',
  KEYWORD: 'KEYWORD',
  OPERATOR: 'OPERATOR',
  PUNCT: 'PUNCT',
  EOF: 'EOF'
};

const FUNCTIONS = new Set(['rate', 'irate', 'sum', 'avg', 'min', 'max', 'count']);
const KEYWORDS = new Set(['by', 'without', 'offset']);

class Lexer {
  constructor(input) {
    this.input = input;
    this.pos = 0;
    this.tokens = [];
  }

  tokenize() {
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.input[this.pos];

      if (ch === '"' || ch === "'") {
        this.readString(ch);
        continue;
      }

      if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.input[this.pos + 1]))) {
        this.readNumber();
        continue;
      }

      if (this.isLetter(ch) || ch === '_') {
        this.readIdent();
        continue;
      }

      if (this.isOperatorStart(ch)) {
        this.readOperator();
        continue;
      }

      if ('(){}[],~'.includes(ch)) {
        this.tokens.push({ type: TokenType.PUNCT, value: ch, pos: this.pos });
        this.pos++;
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    this.tokens.push({ type: TokenType.EOF, value: '', pos: this.pos });
    return this.tokens;
  }

  skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  }

  isOperatorStart(ch) {
    return '+-*/%^=!<>~'.includes(ch);
  }

  readString(quote) {
    const start = this.pos;
    this.pos++;
    let value = '';

    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\') {
        this.pos++;
        if (this.pos >= this.input.length) break;
        const esc = this.input[this.pos];
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          case '\\': value += '\\'; break;
          default: value += esc;
        }
      } else {
        value += this.input[this.pos];
      }
      this.pos++;
    }

    if (this.pos >= this.input.length) {
      throw new Error(`Unterminated string starting at position ${start}`);
    }

    this.pos++;
    this.tokens.push({ type: TokenType.STRING, value, pos: start });
  }

  readNumber() {
    const start = this.pos;
    while (this.pos < this.input.length && (this.isDigit(this.input[this.pos]) || this.input[this.pos] === '.')) {
      this.pos++;
    }
    const value = parseFloat(this.input.slice(start, this.pos));
    this.tokens.push({ type: TokenType.NUMBER, value, pos: start });
  }

  readIdent() {
    const start = this.pos;
    while (this.pos < this.input.length && (this.isLetter(this.input[this.pos]) || this.isDigit(this.input[this.pos]) || this.input[this.pos] === '_' || this.input[this.pos] === '.')) {
      this.pos++;
    }
    const value = this.input.slice(start, this.pos);

    let type = TokenType.IDENT;
    if (FUNCTIONS.has(value)) {
      type = TokenType.FUNCTION;
    } else if (KEYWORDS.has(value)) {
      type = TokenType.KEYWORD;
    }

    this.tokens.push({ type, value, pos: start });
  }

  readOperator() {
    const start = this.pos;
    const ch = this.input[this.pos];
    const next = this.input[this.pos + 1];

    if ((ch === '=' && next === '=') ||
        (ch === '!' && next === '=') ||
        (ch === '<' && next === '=') ||
        (ch === '>' && next === '=') ||
        (ch === '=' && next === '~') ||
        (ch === '!' && next === '~')) {
      this.tokens.push({ type: TokenType.OPERATOR, value: ch + next, pos: start });
      this.pos += 2;
      return;
    }

    if (ch === '=' || ch === '!' || ch === '<' || ch === '>' ||
        ch === '+' || ch === '-' || ch === '*' || ch === '/' ||
        ch === '%' || ch === '^') {
      this.tokens.push({ type: TokenType.OPERATOR, value: ch, pos: start });
      this.pos++;
      return;
    }

    throw new Error(`Unexpected operator '${ch}' at position ${start}`);
  }
}

class ASTNode {
  constructor(type) {
    this.type = type;
  }
}

class NumberLiteral extends ASTNode {
  constructor(value) {
    super('NumberLiteral');
    this.value = value;
  }
}

class VectorSelector extends ASTNode {
  constructor(metric, matchers = [], offset = 0, range = 0) {
    super('VectorSelector');
    this.metric = metric;
    this.matchers = matchers;
    this.offset = offset;
    this.range = range;
  }
}

class LabelMatcher {
  constructor(name, operator, value) {
    this.name = name;
    this.operator = operator;
    this.value = value;
  }
}

class BinaryExpr extends ASTNode {
  constructor(operator, left, right) {
    super('BinaryExpr');
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

class UnaryExpr extends ASTNode {
  constructor(operator, operand) {
    super('UnaryExpr');
    this.operator = operator;
    this.operand = operand;
  }
}

class CallExpr extends ASTNode {
  constructor(func, args) {
    super('CallExpr');
    this.func = func;
    this.args = args;
  }
}

class AggregateExpr extends ASTNode {
  constructor(agg, expr, grouping = [], by = true) {
    super('AggregateExpr');
    this.agg = agg;
    this.expr = expr;
    this.grouping = grouping;
    this.by = by;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse() {
    const expr = this.parseExpression();
    if (!this.isAt(TokenType.EOF)) {
      throw new Error(`Unexpected token '${this.current().value}' at position ${this.current().pos}`);
    }
    return expr;
  }

  current() {
    return this.tokens[this.pos];
  }

  isAt(type, value = null) {
    const tok = this.current();
    return tok.type === type && (value === null || tok.value === value);
  }

  advance() {
    return this.tokens[this.pos++];
  }

  expect(type, value = null) {
    const tok = this.current();
    if (tok.type !== type || (value !== null && tok.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ''} but got ${tok.type} '${tok.value}' at position ${tok.pos}`);
    }
    return this.advance();
  }

  parseExpression() {
    return this.parseBinaryExpr(1);
  }

  parseBinaryExpr(precedence) {
    let left = this.parseUnaryExpr();

    while (true) {
      const tok = this.current();
      if (tok.type !== TokenType.OPERATOR) break;

      const opPrec = this.getPrecedence(tok.value);
      if (opPrec < precedence) break;

      this.advance();
      const right = this.parseBinaryExpr(opPrec + 1);
      left = new BinaryExpr(tok.value, left, right);
    }

    return left;
  }

  getPrecedence(op) {
    if (op === '^') return 6;
    if (op === '*' || op === '/' || op === '%') return 5;
    if (op === '+' || op === '-') return 4;
    if (op === '==' || op === '!=' || op === '<=' || op === '>=' || op === '<' || op === '>') return 3;
    if (op === '=~' || op === '!~') return 3;
    return 0;
  }

  parseUnaryExpr() {
    const tok = this.current();
    if (tok.type === TokenType.OPERATOR && (tok.value === '+' || tok.value === '-')) {
      this.advance();
      const operand = this.parseUnaryExpr();
      return new UnaryExpr(tok.value, operand);
    }
    return this.parsePrimaryExpr();
  }

  parsePrimaryExpr() {
    const tok = this.current();
    let expr;

    if (tok.type === TokenType.NUMBER) {
      this.advance();
      expr = new NumberLiteral(tok.value);
    } else if (tok.type === TokenType.FUNCTION) {
      expr = this.parseFunction();
    } else if (tok.type === TokenType.IDENT) {
      expr = this.parseVectorSelector();
    } else if (tok.type === TokenType.PUNCT && tok.value === '(') {
      this.advance();
      expr = this.parseExpression();
      this.expect(TokenType.PUNCT, ')');
    } else {
      throw new Error(`Unexpected token '${tok.value}' at position ${tok.pos}`);
    }

    if (this.isAt(TokenType.KEYWORD, 'offset')) {
      this.advance();
      const offset = this.parseDuration();
      if (expr instanceof VectorSelector) {
        expr.offset = offset;
      } else {
        expr.offset = offset;
      }
    }

    return expr;
  }

  parseFunction() {
    const funcTok = this.advance();
    const funcName = funcTok.value;

    let grouping = [];
    let by = true;

    if (['sum', 'avg', 'min', 'max', 'count'].includes(funcName)) {
      if (this.isAt(TokenType.KEYWORD, 'by') || this.isAt(TokenType.KEYWORD, 'without')) {
        const keywordTok = this.advance();
        by = keywordTok.value === 'by';

        this.expect(TokenType.PUNCT, '(');
        if (!this.isAt(TokenType.PUNCT, ')')) {
          grouping.push(this.expect(TokenType.IDENT).value);
          while (this.isAt(TokenType.PUNCT, ',')) {
            this.advance();
            grouping.push(this.expect(TokenType.IDENT).value);
          }
        }
        this.expect(TokenType.PUNCT, ')');
      }

      this.expect(TokenType.PUNCT, '(');
      const expr = this.parseExpression();
      this.expect(TokenType.PUNCT, ')');

      return new AggregateExpr(funcName, expr, grouping, by);
    }

    this.expect(TokenType.PUNCT, '(');
    const args = [];
    if (!this.isAt(TokenType.PUNCT, ')')) {
      args.push(this.parseExpression());
      while (this.isAt(TokenType.PUNCT, ',')) {
        this.advance();
        args.push(this.parseExpression());
      }
    }
    this.expect(TokenType.PUNCT, ')');

    return new CallExpr(funcName, args);
  }

  parseVectorSelector() {
    const metricTok = this.advance();
    const metric = metricTok.value;
    const matchers = [];
    let range = 0;

    if (this.isAt(TokenType.PUNCT, '{')) {
      this.advance();
      if (!this.isAt(TokenType.PUNCT, '}')) {
        matchers.push(this.parseLabelMatcher());
        while (this.isAt(TokenType.PUNCT, ',')) {
          this.advance();
          matchers.push(this.parseLabelMatcher());
        }
      }
      this.expect(TokenType.PUNCT, '}');
    }

    if (this.isAt(TokenType.PUNCT, '[')) {
      this.advance();
      range = this.parseDuration();
      this.expect(TokenType.PUNCT, ']');
    }

    return new VectorSelector(metric, matchers, 0, range);
  }

  parseLabelMatcher() {
    const nameTok = this.expect(TokenType.IDENT);
    const opTok = this.current();

    if (opTok.type !== TokenType.OPERATOR || !['=', '!=', '=~', '!~'].includes(opTok.value)) {
      throw new Error(`Expected label matcher operator but got '${opTok.value}' at position ${opTok.pos}`);
    }

    this.advance();
    const valueTok = this.expect(TokenType.STRING);

    return new LabelMatcher(nameTok.value, opTok.value, valueTok.value);
  }

  parseDuration() {
    const tok = this.current();
    if (tok.type === TokenType.NUMBER) {
      const num = tok.value;
      this.advance();
      const unitTok = this.expect(TokenType.IDENT);
      return parseDurationUnit(num, unitTok.value);
    }

    if (tok.type === TokenType.STRING) {
      this.advance();
      return parseDurationString(tok.value);
    }

    throw new Error(`Expected duration at position ${tok.pos}`);
  }
}

function parseDurationUnit(num, unit) {
  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'w': 7 * 24 * 60 * 60 * 1000
  };

  if (!multipliers[unit]) {
    throw new Error(`Invalid duration unit '${unit}'`);
  }

  return num * multipliers[unit];
}

function parseDurationString(str) {
  const match = str.match(/^(\d+(?:\.\d+)?)(s|m|h|d|w)$/);
  if (!match) {
    throw new Error(`Invalid duration '${str}'`);
  }
  return parseDurationUnit(parseFloat(match[1]), match[2]);
}

class PromQLEvaluator {
  constructor(db) {
    this.db = db;
  }

  evaluate(ast, startTime, endTime, step) {
    return this.evaluateNode(ast, startTime, endTime, step);
  }

  evaluateNode(node, startTime, endTime, step) {
    let result;
    switch (node.type) {
      case 'NumberLiteral':
        result = this.evaluateNumberLiteral(node, startTime, endTime, step);
        break;
      case 'VectorSelector':
        result = this.evaluateVectorSelector(node, startTime, endTime, step);
        break;
      case 'BinaryExpr':
        result = this.evaluateBinaryExpr(node, startTime, endTime, step);
        break;
      case 'UnaryExpr':
        result = this.evaluateUnaryExpr(node, startTime, endTime, step);
        break;
      case 'CallExpr':
        result = this.evaluateCallExpr(node, startTime, endTime, step);
        break;
      case 'AggregateExpr':
        result = this.evaluateAggregateExpr(node, startTime, endTime, step);
        break;
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }

    if (node.offset && node.offset > 0 && node.type !== 'VectorSelector') {
      result = this.applyOffset(result, node.offset);
    }

    return result;
  }

  applyOffset(result, offset) {
    return result.map(series => ({
      metric: series.metric,
      tags: series.tags,
      values: series.values.map(v => ({
        timestamp: v.timestamp + offset,
        value: v.value
      }))
    }));
  }

  evaluateNumberLiteral(node, startTime, endTime, step) {
    const values = [];
    for (let ts = startTime; ts <= endTime; ts += step) {
      values.push({ timestamp: ts, value: node.value });
    }
    return [{ metric: '', tags: {}, values }];
  }

  evaluateVectorSelector(node, startTime, endTime, step) {
    const adjustedStart = startTime - node.offset;
    const adjustedEnd = endTime - node.offset;

    let sql = `SELECT ts, value, tags FROM points WHERE metric = ? AND ts >= ? AND ts <= ?`;
    const params = [node.metric, adjustedStart, adjustedEnd];

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    const seriesMap = new Map();

    for (const row of rows) {
      let tags = {};
      if (row.tags) {
        try {
          tags = JSON.parse(row.tags);
        } catch (e) {
          tags = {};
        }
      }

      if (!this.matchLabels(tags, node.matchers)) {
        continue;
      }

      const tagsKey = JSON.stringify(tags);
      if (!seriesMap.has(tagsKey)) {
        seriesMap.set(tagsKey, { metric: node.metric, tags, points: [] });
      }
      seriesMap.get(tagsKey).points.push({
        timestamp: row.ts + node.offset,
        value: row.value
      });
    }

    const result = [];
    for (const series of seriesMap.values()) {
      series.points.sort((a, b) => a.timestamp - b.timestamp);
      const resampled = this.resample(series.points, startTime, endTime, step);
      result.push({ metric: series.metric, tags: series.tags, values: resampled });
    }

    return result;
  }

  matchLabels(tags, matchers) {
    for (const matcher of matchers) {
      const tagValue = tags[matcher.name] !== undefined ? String(tags[matcher.name]) : '';
      const matcherValue = matcher.value;

      switch (matcher.operator) {
        case '=':
          if (tagValue !== matcherValue) return false;
          break;
        case '!=':
          if (tagValue === matcherValue) return false;
          break;
        case '=~': {
          const regex = new RegExp(matcherValue);
          if (!regex.test(tagValue)) return false;
          break;
        }
        case '!~': {
          const regex = new RegExp(matcherValue);
          if (regex.test(tagValue)) return false;
          break;
        }
        default:
          throw new Error(`Unknown matcher operator: ${matcher.operator}`);
      }
    }
    return true;
  }

  resample(points, startTime, endTime, step) {
    const result = [];
    const stalenessMs = 5 * 60 * 1000;

    for (let ts = startTime; ts <= endTime; ts += step) {
      let value = null;
      let bestDist = Infinity;

      for (const point of points) {
        const dist = Math.abs(point.timestamp - ts);
        if (dist <= stalenessMs && dist < bestDist) {
          bestDist = dist;
          value = point.value;
        }
      }

      if (value !== null) {
        result.push({ timestamp: ts, value });
      }
    }

    return result;
  }

  evaluateBinaryExpr(node, startTime, endTime, step) {
    const left = this.evaluateNode(node.left, startTime, endTime, step);
    const right = this.evaluateNode(node.right, startTime, endTime, step);

    const leftIsScalar = left.length === 1 && Object.keys(left[0].tags).length === 0 && left[0].metric === '';
    const rightIsScalar = right.length === 1 && Object.keys(right[0].tags).length === 0 && right[0].metric === '';

    if (leftIsScalar && rightIsScalar) {
      return this.scalarBinaryOp(node.operator, left[0], right[0], startTime, endTime, step);
    }

    if (leftIsScalar) {
      return this.scalarVectorBinaryOp(node.operator, left[0], right, startTime, endTime, step, true);
    }

    if (rightIsScalar) {
      return this.scalarVectorBinaryOp(node.operator, right[0], left, startTime, endTime, step, false);
    }

    return this.vectorVectorBinaryOp(node.operator, left, right, startTime, endTime, step);
  }

  scalarBinaryOp(op, left, right, startTime, endTime, step) {
    const values = [];
    const leftVals = new Map(left.values.map(v => [v.timestamp, v.value]));
    const rightVals = new Map(right.values.map(v => [v.timestamp, v.value]));

    for (let ts = startTime; ts <= endTime; ts += step) {
      const lv = leftVals.get(ts);
      const rv = rightVals.get(ts);
      if (lv !== undefined && rv !== undefined) {
        values.push({ timestamp: ts, value: this.applyBinaryOp(op, lv, rv) });
      }
    }

    return [{ metric: '', tags: {}, values }];
  }

  scalarVectorBinaryOp(op, scalar, vectors, startTime, endTime, step, scalarLeft) {
    const scalarVals = new Map(scalar.values.map(v => [v.timestamp, v.value]));
    const result = [];

    for (const series of vectors) {
      const values = [];
      const seriesVals = new Map(series.values.map(v => [v.timestamp, v.value]));

      for (let ts = startTime; ts <= endTime; ts += step) {
        const sv = scalarVals.get(ts);
        const vv = seriesVals.get(ts);
        if (sv !== undefined && vv !== undefined) {
          const value = scalarLeft ? this.applyBinaryOp(op, sv, vv) : this.applyBinaryOp(op, vv, sv);
          values.push({ timestamp: ts, value });
        }
      }

      if (values.length > 0) {
        result.push({ metric: series.metric, tags: series.tags, values });
      }
    }

    return result;
  }

  vectorVectorBinaryOp(op, left, right, startTime, endTime, step) {
    const rightMap = new Map();
    for (const series of right) {
      rightMap.set(JSON.stringify(series.tags), series);
    }

    const result = [];

    for (const leftSeries of left) {
      const rightSeries = rightMap.get(JSON.stringify(leftSeries.tags));
      if (!rightSeries) continue;

      const values = [];
      const leftVals = new Map(leftSeries.values.map(v => [v.timestamp, v.value]));
      const rightVals = new Map(rightSeries.values.map(v => [v.timestamp, v.value]));

      for (let ts = startTime; ts <= endTime; ts += step) {
        const lv = leftVals.get(ts);
        const rv = rightVals.get(ts);
        if (lv !== undefined && rv !== undefined) {
          values.push({ timestamp: ts, value: this.applyBinaryOp(op, lv, rv) });
        }
      }

      if (values.length > 0) {
        result.push({ metric: leftSeries.metric, tags: leftSeries.tags, values });
      }
    }

    return result;
  }

  applyBinaryOp(op, left, right) {
    switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return right === 0 ? NaN : left / right;
      case '%': return right === 0 ? NaN : left % right;
      case '^': return Math.pow(left, right);
      case '==': return left === right ? 1 : 0;
      case '!=': return left !== right ? 1 : 0;
      case '<': return left < right ? 1 : 0;
      case '>': return left > right ? 1 : 0;
      case '<=': return left <= right ? 1 : 0;
      case '>=': return left >= right ? 1 : 0;
      default: throw new Error(`Unknown binary operator: ${op}`);
    }
  }

  evaluateUnaryExpr(node, startTime, endTime, step) {
    const operand = this.evaluateNode(node.operand, startTime, endTime, step);
    const result = [];

    for (const series of operand) {
      const values = series.values.map(v => ({
        timestamp: v.timestamp,
        value: node.operator === '-' ? -v.value : v.value
      }));
      result.push({ metric: series.metric, tags: series.tags, values });
    }

    return result;
  }

  evaluateCallExpr(node, startTime, endTime, step) {
    switch (node.func) {
      case 'rate':
        return this.evaluateRate(node.args[0], startTime, endTime, step, false);
      case 'irate':
        return this.evaluateRate(node.args[0], startTime, endTime, step, true);
      default:
        throw new Error(`Unknown function: ${node.func}`);
    }
  }

  evaluateRate(argNode, startTime, endTime, step, isInstant) {
    if (!(argNode instanceof VectorSelector)) {
      throw new Error('rate/irate requires a vector selector as argument');
    }

    const rangeSelector = this.extractRange(argNode);
    const windowMs = rangeSelector.window;

    const adjustedStart = startTime - windowMs;
    const adjustedEnd = endTime;

    let sql = `SELECT ts, value, tags FROM points WHERE metric = ? AND ts >= ? AND ts <= ?`;
    const params = [argNode.metric, adjustedStart - argNode.offset, adjustedEnd - argNode.offset];

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    const seriesMap = new Map();

    for (const row of rows) {
      let tags = {};
      if (row.tags) {
        try {
          tags = JSON.parse(row.tags);
        } catch (e) {
          tags = {};
        }
      }

      if (!this.matchLabels(tags, argNode.matchers)) {
        continue;
      }

      const tagsKey = JSON.stringify(tags);
      if (!seriesMap.has(tagsKey)) {
        seriesMap.set(tagsKey, { metric: argNode.metric, tags, points: [] });
      }
      seriesMap.get(tagsKey).points.push({
        timestamp: row.ts + argNode.offset,
        value: row.value
      });
    }

    const result = [];

    for (const series of seriesMap.values()) {
      series.points.sort((a, b) => a.timestamp - b.timestamp);
      const values = [];

      for (let ts = startTime; ts <= endTime; ts += step) {
        const windowStart = ts - windowMs;
        const windowPoints = series.points.filter(p => p.timestamp >= windowStart && p.timestamp <= ts);

        if (windowPoints.length < 2) continue;

        let rate;
        if (isInstant) {
          const lastTwo = windowPoints.slice(-2);
          let diff = lastTwo[1].value - lastTwo[0].value;
          if (diff < 0) diff = lastTwo[1].value;
          const timeDiff = (lastTwo[1].timestamp - lastTwo[0].timestamp) / 1000;
          rate = timeDiff > 0 ? diff / timeDiff : 0;
        } else {
          let diff = 0;
          let prevValue = null;
          for (const p of windowPoints) {
            if (prevValue !== null) {
              const d = p.value - prevValue;
              diff += d >= 0 ? d : p.value;
            }
            prevValue = p.value;
          }
          const timeDiff = (windowPoints[windowPoints.length - 1].timestamp - windowPoints[0].timestamp) / 1000;
          rate = timeDiff > 0 ? diff / timeDiff : 0;
        }

        values.push({ timestamp: ts, value: rate });
      }

      if (values.length > 0) {
        result.push({ metric: series.metric, tags: series.tags, values });
      }
    }

    return result;
  }

  extractRange(node) {
    const windowMs = node.range && node.range > 0 ? node.range : 5 * 60 * 1000;
    return { window: windowMs };
  }

  evaluateAggregateExpr(node, startTime, endTime, step) {
    const operand = this.evaluateNode(node.expr, startTime, endTime, step);

    const groups = new Map();

    for (const series of operand) {
      const groupTags = this.filterTags(series.tags, node.grouping, node.by);
      const groupKey = JSON.stringify(groupTags);

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { metric: '', tags: groupTags, series: [] });
      }
      groups.get(groupKey).series.push(series);
    }

    const result = [];

    for (const group of groups.values()) {
      const timestampValues = new Map();

      for (const series of group.series) {
        for (const v of series.values) {
          if (!timestampValues.has(v.timestamp)) {
            timestampValues.set(v.timestamp, []);
          }
          timestampValues.get(v.timestamp).push(v.value);
        }
      }

      const values = [];
      for (let ts = startTime; ts <= endTime; ts += step) {
        const vals = timestampValues.get(ts) || [];
        if (vals.length === 0) continue;

        let aggValue;
        switch (node.agg) {
          case 'sum':
            aggValue = vals.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            aggValue = vals.reduce((a, b) => a + b, 0) / vals.length;
            break;
          case 'min':
            aggValue = Math.min(...vals);
            break;
          case 'max':
            aggValue = Math.max(...vals);
            break;
          case 'count':
            aggValue = vals.length;
            break;
          default:
            throw new Error(`Unknown aggregation: ${node.agg}`);
        }

        values.push({ timestamp: ts, value: aggValue });
      }

      if (values.length > 0) {
        result.push({ metric: group.metric, tags: group.tags, values });
      }
    }

    return result;
  }

  filterTags(tags, grouping, by) {
    if (by) {
      const result = {};
      for (const key of grouping) {
        if (tags.hasOwnProperty(key)) {
          result[key] = tags[key];
        }
      }
      return result;
    } else {
      const result = { ...tags };
      for (const key of grouping) {
        delete result[key];
      }
      return result;
    }
  }
}

function parsePromQL(query) {
  const lexer = new Lexer(query);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

module.exports = {
  Lexer,
  Parser,
  PromQLEvaluator,
  parsePromQL,
  parseDurationString,
  TokenType,
  NumberLiteral,
  VectorSelector,
  BinaryExpr,
  UnaryExpr,
  CallExpr,
  AggregateExpr,
  LabelMatcher
};
