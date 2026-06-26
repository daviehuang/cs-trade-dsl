// 宿主 B：JVM（中台 MS）经 Chicory 加载【同一个】kernel.wasm 执行。
// 证明路线 B 真身：JS 与 Java 不是两套实现，而是同一个 wasm 二进制的两个宿主。
import com.dylibso.chicory.runtime.Instance;
import com.dylibso.chicory.runtime.ExportFunction;
import com.dylibso.chicory.wasm.Parser;
import com.dylibso.chicory.wasm.WasmModule;
import java.math.BigInteger;
import java.nio.file.*;
import java.util.*;

public class RunWasm {
    public static void main(String[] args) throws Exception {
        // 加载同一个 kernel.wasm（由 kernel.wat 单源编译）
        WasmModule module = Parser.parse(Paths.get("../kernel.wasm"));
        Instance inst = Instance.builder(module).build();
        ExportFunction dadd = inst.export("dadd");
        ExportFunction dsub = inst.export("dsub");
        ExportFunction dmul = inst.export("dmul");
        ExportFunction ddiv = inst.export("ddiv");
        ExportFunction dround = inst.export("dround");

        String text = Files.readString(Paths.get("../cases.json"));
        List<Object> cases = (List<Object>) new Json(text).parse();

        StringBuilder out = new StringBuilder("[\n");
        for (int idx = 0; idx < cases.size(); idx++) {
            Map<String,Object> c = (Map<String,Object>) cases.get(idx);
            String id = (String) c.get("id");
            String op = (String) c.get("op");
            long a = Long.parseLong((String) c.get("a"));
            long raw;
            switch (op) {
                case "dadd": raw = dadd.apply(a, Long.parseLong((String) c.get("b")))[0]; break;
                case "dsub": raw = dsub.apply(a, Long.parseLong((String) c.get("b")))[0]; break;
                case "dmul": raw = dmul.apply(a, Long.parseLong((String) c.get("b")))[0]; break;
                case "ddiv": raw = ddiv.apply(a, Long.parseLong((String) c.get("b")))[0]; break;
                case "dround": raw = dround.apply(a, Long.parseLong((String) c.get("n")))[0]; break;
                default: throw new RuntimeException("op?");
            }
            System.out.printf("  %-18s raw=%12d  = %s%n", id, raw, dec(raw));
            out.append(String.format("  {\"id\":\"%s\",\"raw\":\"%d\",\"decimal\":\"%s\"}%s%n",
                    id, raw, dec(raw), idx < cases.size()-1 ? "," : ""));
        }
        out.append("]\n");
        Files.writeString(Paths.get("../results.java.json"), out.toString());
        System.out.printf("%nJVM(中台) over kernel.wasm: %d 用例完成%n", cases.size());
    }

    static final BigInteger SCALE = BigInteger.valueOf(1000000);
    static String dec(long scaled) {
        BigInteger v = BigInteger.valueOf(scaled).abs();
        String f = v.mod(SCALE).toString();
        f = "000000".substring(f.length()) + f;
        f = f.replaceAll("0+$", "");
        return (scaled < 0 ? "-" : "") + v.divide(SCALE) + (f.isEmpty() ? "" : "." + f);
    }

    // 极简 JSON 解析（object/array/string/number）；数字当字符串返回
    static final class Json {
        final String s; int i = 0;
        Json(String s){this.s=s;}
        Object parse(){ skip(); return value(); }
        void skip(){ while(i<s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        Object value(){ skip(); char c=s.charAt(i);
            if(c=='{') return obj(); if(c=='[') return arr(); if(c=='"') return str();
            if(c=='t'){i+=4;return Boolean.TRUE;} if(c=='f'){i+=5;return Boolean.FALSE;}
            if(c=='n'){i+=4;return null;} return num(); }
        Map<String,Object> obj(){ Map<String,Object> m=new LinkedHashMap<>(); i++; skip();
            if(s.charAt(i)=='}'){i++;return m;}
            while(true){ skip(); String k=str(); skip(); i++; m.put(k,value()); skip();
                if(s.charAt(i)==','){i++;continue;} i++; break; } return m; }
        List<Object> arr(){ List<Object> a=new ArrayList<>(); i++; skip();
            if(s.charAt(i)==']'){i++;return a;}
            while(true){ a.add(value()); skip();
                if(s.charAt(i)==','){i++;continue;} i++; break; } return a; }
        String str(){ StringBuilder b=new StringBuilder(); i++;
            while(s.charAt(i)!='"'){ char c=s.charAt(i++); if(c=='\\') b.append(s.charAt(i++)); else b.append(c);} i++; return b.toString(); }
        String num(){ int st=i; while(i<s.length() && "+-0123456789.eE".indexOf(s.charAt(i))>=0) i++; return s.substring(st,i); }
    }
}
