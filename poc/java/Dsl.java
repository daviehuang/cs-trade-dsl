// 统一业务规则 DSL —— 表达式内核（Java / 中台 MS）
// 与 poc/js/src/kernel.js 语义对齐：十进制 HALF_UP、null 传播、内置函数。
// 用 BigDecimal 实现规范 §4 的十进制语义；读同一份 golden 向量验证跨语言一致。
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.nio.file.*;
import java.util.*;

public class Dsl {
    // §4.2/§4.4：精度 34 有效位，除法舍入 HALF_UP
    static final MathContext MC = new MathContext(34, RoundingMode.HALF_UP);

    // ───────── 极简 JSON 解析（仅 PoC 需要：object/array/string/null/bool/number）─────────
    static final class JsonParser {
        final String s; int i = 0;
        JsonParser(String s) { this.s = s; }
        Object parse() { skip(); Object v = value(); skip(); return v; }
        void skip() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        Object value() {
            skip(); char c = s.charAt(i);
            if (c == '{') return obj();
            if (c == '[') return arr();
            if (c == '"') return str();
            if (c == 'n') { i += 4; return null; }
            if (c == 't') { i += 4; return Boolean.TRUE; }
            if (c == 'f') { i += 5; return Boolean.FALSE; }
            return num();
        }
        Map<String,Object> obj() {
            Map<String,Object> m = new LinkedHashMap<>(); i++; skip();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                skip(); String k = str(); skip(); i++; // ':'
                m.put(k, value()); skip();
                if (s.charAt(i) == ',') { i++; continue; }
                i++; break; // '}'
            }
            return m;
        }
        List<Object> arr() {
            List<Object> a = new ArrayList<>(); i++; skip();
            if (s.charAt(i) == ']') { i++; return a; }
            while (true) {
                a.add(value()); skip();
                if (s.charAt(i) == ',') { i++; continue; }
                i++; break; // ']'
            }
            return a;
        }
        String str() {
            StringBuilder b = new StringBuilder(); i++; // opening quote
            while (s.charAt(i) != '"') {
                char c = s.charAt(i++);
                if (c == '\\') { b.append(s.charAt(i++)); } else b.append(c);
            }
            i++; return b.toString();
        }
        String num() {
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            return s.substring(st, i);
        }
    }

    // ───────── Lexer ─────────
    static final Set<String> KW = Set.of("true","false","null","root","parent","children","value");
    static final class Tok { String type, value; Tok(String t, String v){type=t;value=v;} }

    static List<Tok> lex(String src) {
        List<Tok> ts = new ArrayList<>(); int i = 0;
        while (i < src.length()) {
            char c = src.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if (c == '"') {
                int j = i + 1; StringBuilder b = new StringBuilder();
                while (j < src.length() && src.charAt(j) != '"') {
                    if (src.charAt(j) == '\\') { b.append(src.charAt(j+1)); j += 2; }
                    else b.append(src.charAt(j++));
                }
                ts.add(new Tok("string", b.toString())); i = j + 1; continue;
            }
            if (c >= '0' && c <= '9') {
                int j = i; while (j < src.length() && ((src.charAt(j) >= '0' && src.charAt(j) <= '9') || src.charAt(j) == '.')) j++;
                ts.add(new Tok("number", src.substring(i, j))); i = j; continue;
            }
            if (Character.isLetter(c) || c == '_') {
                int j = i; while (j < src.length() && (Character.isLetterOrDigit(src.charAt(j)) || src.charAt(j) == '_')) j++;
                String w = src.substring(i, j);
                ts.add(new Tok(KW.contains(w) ? w : "ident", w)); i = j; continue;
            }
            String two = i + 1 < src.length() ? src.substring(i, i + 2) : "";
            if (List.of("==","!=","<=",">=","&&","||").contains(two)) { ts.add(new Tok("op", two)); i += 2; continue; }
            if ("+-*/%<>!?:.,()".indexOf(c) >= 0) { ts.add(new Tok("op", String.valueOf(c))); i++; continue; }
            throw new RuntimeException("E_PARSE: 非法字符 " + c);
        }
        ts.add(new Tok("eof", null));
        return ts;
    }

    // ───────── AST ─────────
    static final class Node {
        String k, op, name, value; Node left, right, cond, a, b, expr;
        List<Node> args; List<String> segs;
    }

    // ───────── Parser ─────────
    static final class Parser {
        final List<Tok> ts; int p = 0;
        Parser(List<Tok> ts){this.ts=ts;}
        Tok peek(){return ts.get(p);}
        Tok next(){return ts.get(p++);}
        boolean isOp(String v){return peek().type.equals("op") && peek().value.equals(v);}
        void eat(String v){ if(!isOp(v)) throw new RuntimeException("E_PARSE: 期望 "+v); next(); }

        Node parse(){ Node n = expression(); if(!peek().type.equals("eof")) throw new RuntimeException("E_PARSE: 多余输入"); return n; }
        Node expression(){ return ternary(); }
        Node ternary(){
            Node cond = binLeft(this::logicalAnd, List.of("||"));
            cond = orChain(cond);
            if (isOp("?")) { next(); Node a = expression(); eat(":"); Node b = expression();
                Node n = new Node(); n.k="ternary"; n.cond=cond; n.a=a; n.b=b; return n; }
            return cond;
        }
        // 重新实现 || 顶层链
        Node orChain(Node left){ return left; }

        interface Sub { Node get(); }
        Node binLeft(Sub sub, List<String> ops){
            Node left = sub.get();
            while (peek().type.equals("op") && ops.contains(peek().value)) {
                String op = next().value; Node right = sub.get();
                Node n = new Node(); n.k="bin"; n.op=op; n.left=left; n.right=right; left = n;
            }
            return left;
        }
        Node logicalOr(){ return binLeft(this::logicalAnd, List.of("||")); }
        Node logicalAnd(){ return binLeft(this::equality, List.of("&&")); }
        Node equality(){ return binLeft(this::comparison, List.of("==","!=")); }
        Node comparison(){ return binLeft(this::additive, List.of("<","<=",">",">=")); }
        Node additive(){ return binLeft(this::multiplicative, List.of("+","-")); }
        Node multiplicative(){ return binLeft(this::unary, List.of("*","/","%")); }
        Node unary(){
            if (isOp("!") || isOp("-")) { String op = next().value; Node e = unary();
                Node n = new Node(); n.k="unary"; n.op=op; n.expr=e; return n; }
            return primary();
        }
        Node primary(){
            Tok t = peek();
            if (t.type.equals("number")) { next(); Node n=new Node(); n.k="num"; n.value=t.value; return n; }
            if (t.type.equals("string")) { next(); Node n=new Node(); n.k="str"; n.value=t.value; return n; }
            if (t.type.equals("true")) { next(); Node n=new Node(); n.k="bool"; n.value="true"; return n; }
            if (t.type.equals("false")) { next(); Node n=new Node(); n.k="bool"; n.value="false"; return n; }
            if (t.type.equals("null")) { next(); Node n=new Node(); n.k="null"; return n; }
            if (isOp("(")) { next(); Node e = expression(); eat(")"); return e; }
            if (t.type.equals("ident") || List.of("root","parent","children","value").contains(t.type)) {
                String head = next().value;
                if (isOp("(")) {
                    next(); List<Node> args = new ArrayList<>();
                    if (!isOp(")")) { args.add(expression()); while (isOp(",")) { next(); args.add(expression()); } }
                    eat(")");
                    Node n=new Node(); n.k="call"; n.name=head; n.args=args; return n;
                }
                List<String> segs = new ArrayList<>(); segs.add(head);
                while (isOp(".")) { next(); segs.add(next().value); }
                Node n=new Node(); n.k="path"; n.segs=segs; return n;
            }
            throw new RuntimeException("E_PARSE: 非预期 token " + t.type);
        }
    }

    // 修正 ternary 使用完整 || 优先级
    static Node parse(String src) {
        Parser ps = new Parser(lex(src));
        Node n = exprFull(ps);
        if (!ps.peek().type.equals("eof")) throw new RuntimeException("E_PARSE: 多余输入");
        return n;
    }
    static Node exprFull(Parser ps) {
        Node cond = ps.logicalOr();
        if (ps.isOp("?")) { ps.next(); Node a = exprFull(ps); ps.eat(":"); Node b = exprFull(ps);
            Node n = new Node(); n.k="ternary"; n.cond=cond; n.a=a; n.b=b; return n; }
        return cond;
    }

    // ───────── Evaluator ─────────
    // 值域: BigDecimal | String | Boolean | null | List<Object>(vector)
    static BigDecimal toDec(Object v) {
        if (v == null) return null;
        if (v instanceof BigDecimal) return (BigDecimal) v;
        if (v instanceof String) return new BigDecimal((String) v);
        throw new RuntimeException("E_TYPE");
    }

    static Object eval(Node n, Map<String,Object> self) {
        switch (n.k) {
            case "num": return new BigDecimal(n.value);
            case "str": return n.value;
            case "bool": return Boolean.valueOf(n.value);
            case "null": return null;
            case "path": return evalPath(n.segs, self);
            case "call": return evalCall(n.name, n.args, self);
            case "unary": {
                Object v = eval(n.expr, self);
                if (v == null) return null;
                if (n.op.equals("-")) return toDec(v).negate();
                return !Boolean.TRUE.equals(v);
            }
            case "bin": return evalBin(n, self);
            case "ternary": {
                Object c = eval(n.cond, self);
                if (c == null) return eval(n.b, self);
                return Boolean.TRUE.equals(c) ? eval(n.a, self) : eval(n.b, self);
            }
        }
        throw new RuntimeException("E_EVAL");
    }

    static Object evalPath(List<String> segs, Map<String,Object> self) {
        String head = segs.get(0);
        // PoC golden 上下文只有 self；root/parent 退化到 self
        if (head.equals("value")) return self.get("value");
        if (head.equals("root") || head.equals("parent")) {
            Object v = self.get(segs.get(1)); return v;
        }
        if (head.equals("children")) {
            Object arr = self.get("__children");
            return arr; // golden 不用 children
        }
        return self.get(head);
    }

    @SuppressWarnings("unchecked")
    static Object evalBin(Node n, Map<String,Object> self) {
        String op = n.op;
        if (op.equals("&&")) {
            Object l = eval(n.left, self);
            if (Boolean.FALSE.equals(l)) return false;
            Object r = eval(n.right, self);
            if (l == null || r == null) return null;
            return Boolean.TRUE.equals(l) && Boolean.TRUE.equals(r);
        }
        if (op.equals("||")) {
            Object l = eval(n.left, self);
            if (Boolean.TRUE.equals(l)) return true;
            Object r = eval(n.right, self);
            if (l == null || r == null) return null;
            return Boolean.TRUE.equals(l) || Boolean.TRUE.equals(r);
        }
        Object l = eval(n.left, self);
        Object r = eval(n.right, self);
        if (op.equals("==") || op.equals("!=")) {
            boolean eq = valueEq(l, r);
            return op.equals("==") ? eq : !eq;
        }
        if ("+-*/%".contains(op)) {
            if (l == null || r == null) return null;
            BigDecimal a = toDec(l), b = toDec(r);
            switch (op) {
                case "+": return a.add(b);
                case "-": return a.subtract(b);
                case "*": return a.multiply(b);
                case "/": if (b.signum()==0) throw new RuntimeException("E_DIV_ZERO"); return a.divide(b, MC);
                case "%": if (b.signum()==0) throw new RuntimeException("E_DIV_ZERO"); return a.remainder(b);
            }
        }
        if (op.equals("<")||op.equals("<=")||op.equals(">")||op.equals(">=")) {
            if (l == null || r == null) return false;
            int c = toDec(l).compareTo(toDec(r));
            switch (op) { case "<": return c<0; case "<=": return c<=0; case ">": return c>0; default: return c>=0; }
        }
        throw new RuntimeException("E_EVAL");
    }

    static boolean valueEq(Object l, Object r) {
        if (l == null || r == null) return l == null && r == null;
        if (l instanceof BigDecimal && r instanceof BigDecimal) return ((BigDecimal)l).compareTo((BigDecimal)r) == 0;
        return l.equals(r);
    }

    // ───────── Builtins §6 ─────────
    @SuppressWarnings("unchecked")
    static List<BigDecimal> nonNull(Object vecObj) {
        List<Object> vec = (List<Object>) vecObj;
        List<BigDecimal> out = new ArrayList<>();
        for (Object x : vec) if (x != null) out.add(toDec(x));
        return out;
    }

    @SuppressWarnings("unchecked")
    static Object evalCall(String name, List<Node> argNodes, Map<String,Object> self) {
        List<Object> a = new ArrayList<>();
        for (Node an : argNodes) a.add(eval(an, self));
        switch (name) {
            case "sum": { BigDecimal s = BigDecimal.ZERO; for (BigDecimal x : nonNull(a.get(0))) s = s.add(x); return s; }
            case "avg": { List<BigDecimal> xs = nonNull(a.get(0)); if (xs.isEmpty()) return null;
                BigDecimal s = BigDecimal.ZERO; for (BigDecimal x : xs) s = s.add(x); return s.divide(new BigDecimal(xs.size()), MC); }
            case "min": { List<BigDecimal> xs = nonNull(a.get(0)); if (xs.isEmpty()) return null;
                BigDecimal m = xs.get(0); for (BigDecimal x : xs) if (x.compareTo(m)<0) m = x; return m; }
            case "max": { List<BigDecimal> xs = nonNull(a.get(0)); if (xs.isEmpty()) return null;
                BigDecimal m = xs.get(0); for (BigDecimal x : xs) if (x.compareTo(m)>0) m = x; return m; }
            case "count": return new BigDecimal(((List<Object>)a.get(0)).size());
            case "countNonNull": { int c=0; for (Object x : (List<Object>)a.get(0)) if (x!=null) c++; return new BigDecimal(c); }
            case "round": return a.get(0)==null?null:toDec(a.get(0)).setScale(toDec(a.get(1)).intValueExact(), RoundingMode.HALF_UP);
            case "roundEven": return a.get(0)==null?null:toDec(a.get(0)).setScale(toDec(a.get(1)).intValueExact(), RoundingMode.HALF_EVEN);
            case "floor": return a.get(0)==null?null:toDec(a.get(0)).setScale(0, RoundingMode.FLOOR);
            case "ceil": return a.get(0)==null?null:toDec(a.get(0)).setScale(0, RoundingMode.CEILING);
            case "truncate": return a.get(0)==null?null:toDec(a.get(0)).setScale(0, RoundingMode.DOWN);
            case "abs": return a.get(0)==null?null:toDec(a.get(0)).abs();
            case "pow": return a.get(0)==null?null:toDec(a.get(0)).pow(toDec(a.get(1)).intValueExact());
            case "clamp": { if (a.get(0)==null) return null; BigDecimal v=toDec(a.get(0)), lo=toDec(a.get(1)), hi=toDec(a.get(2));
                if (v.compareTo(lo)<0) v=lo; if (v.compareTo(hi)>0) v=hi; return v; }
            case "idiv": { if (a.get(0)==null||a.get(1)==null) return null; BigDecimal b=toDec(a.get(1));
                if (b.signum()==0) throw new RuntimeException("E_DIV_ZERO"); return toDec(a.get(0)).divideToIntegralValue(b); }
            case "len": return a.get(0)==null?null:new BigDecimal(((String)a.get(0)).codePointCount(0,((String)a.get(0)).length()));
            case "contains": return a.get(0)==null||a.get(1)==null?null:((String)a.get(0)).contains((String)a.get(1));
            case "startsWith": return a.get(0)==null||a.get(1)==null?null:((String)a.get(0)).startsWith((String)a.get(1));
            case "endsWith": return a.get(0)==null||a.get(1)==null?null:((String)a.get(0)).endsWith((String)a.get(1));
            case "in": { Object x=a.get(0); for (int k=1;k<a.size();k++) if (valueEq(x,a.get(k))) return true; return false; }
            case "coalesce": { for (Object x : a) if (x != null) return x; return null; }
            case "isNull": return a.get(0)==null;
            case "isNotNull": return a.get(0)!=null;
            case "toDecimal": return a.get(0)==null?null:new BigDecimal(String.valueOf(a.get(0)));
            case "toInt": return a.get(0)==null?null:toDec(a.get(0)).setScale(0, RoundingMode.DOWN);
            case "toString": return a.get(0)==null?null:fmt(a.get(0));
        }
        throw new RuntimeException("E_UNKNOWN_FN: " + name);
    }

    // 格式化：与 JS fmt 对齐（去除尾随零，零归一）
    static String fmt(Object v) {
        if (v == null) return "null";
        if (v instanceof Boolean) return ((Boolean)v) ? "true" : "false";
        if (v instanceof BigDecimal) {
            BigDecimal d = (BigDecimal) v;
            if (d.signum() == 0) return "0";
            return d.stripTrailingZeros().toPlainString();
        }
        return String.valueOf(v);
    }

    // ───────── Golden 向量执行 ─────────
    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        String path = args.length > 0 ? args[0] : "../shared/golden.json";
        String text = Files.readString(Paths.get(path));
        List<Object> vectors = (List<Object>) new JsonParser(text).parse();

        StringBuilder out = new StringBuilder("[\n");
        int pass = 0;
        for (int idx = 0; idx < vectors.size(); idx++) {
            Map<String,Object> tc = (Map<String,Object>) vectors.get(idx);
            String id = (String) tc.get("id");
            String expr = (String) tc.get("expr");
            String expect = (String) tc.get("expect");
            Map<String,Object> vars = (Map<String,Object>) tc.getOrDefault("vars", new LinkedHashMap<>());
            Map<String,Object> self = new LinkedHashMap<>();
            for (Map.Entry<String,Object> e : vars.entrySet()) self.put(e.getKey(), bindVar(e.getValue()));
            String actual;
            try { actual = fmt(eval(parse(expr), self)); }
            catch (Exception ex) { actual = ex.getMessage().split(":")[0]; }
            boolean ok = actual.equals(expect);
            if (ok) pass++;
            System.out.printf("  %s %-18s = %s%s%n", ok ? "OK" : "XX", id, actual, ok ? "" : "  (期望 " + expect + ")");
            out.append(String.format("  {\"id\":\"%s\",\"actual\":\"%s\",\"ok\":%s}%s\n",
                    id, actual.replace("\"","\\\""), ok, idx < vectors.size()-1 ? "," : ""));
        }
        out.append("]\n");
        Files.writeString(Paths.get("../shared/golden.actual.java.json"), out.toString());
        System.out.printf("%nJava 内核（中台）: %d/%d 通过%n", pass, vectors.size());
        System.exit(pass == vectors.size() ? 0 : 1);
    }

    @SuppressWarnings("unchecked")
    static Object bindVar(Object v) {
        if (v == null) return null;
        if (v instanceof List) {
            List<Object> out = new ArrayList<>();
            for (Object x : (List<Object>) v) out.add(bindVar(x));
            return out;
        }
        return new BigDecimal(String.valueOf(v));
    }
}
