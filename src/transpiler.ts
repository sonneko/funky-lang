export function transpile(ast: any): string {
  if (ast.type === "Program") {
    return ast.body.map(transpile).join("\n\n");
  }

  switch (ast.type) {
    case "Using":
      return `import { ${ast.ids.map((i: any) => i.as ? `${i.id} as ${i.as}` : i.id).join(", ")} } from ${ast.from.value};`;

    case "FunctionDeclaration": {
      const params = ast.params.params;
      const returnType = transpile(ast.params.returnType);
      let code = `declare const ${ast.id}: `;
      if (params.length === 0) {
        code += `() => ${returnType}`;
      } else {
        for (const p of params) {
          code += `(arg: ${transpile(p.type)}) => `;
        }
        code += returnType;
      }
      return code + ";";
    }

    case "Function": {
      let code = "";
      const params = ast.params.params;
      const returnType = transpile(ast.params.returnType);

      // We ignore protocols for now as requested (no implementation check)
      // But we can keep them as comments or generic constraints if we want.

      code += `export const ${ast.id} = `;
      if (params.length === 0) {
        code += `(): ${returnType} => `;
      } else {
        for (const p of params) {
          code += `(${p.id}: ${transpile(p.type)}) => `;
        }
      }

      if (ast.body.type === "Intrinsic") {
        code += `__intrinsic_${ast.body.id}`;
      } else {
        code += transpile(ast.body);
      }
      return code + ";";
    }

    case "TypeDefinition":
      return `export type ${ast.id} = ${transpile(ast.type_node || ast.type)};`;

    case "TypeReference":
      return `${ast.id}${ast.args.length > 0 ? `<${ast.args.map(transpile).join(", ")}>` : ""}`;

    case "ParenType":
      return `(${transpile(ast.type)})`;

    case "StructType": {
      const tps = ast.typeParams.length > 0 ? `<${ast.typeParams.join(", ")}>` : "";
      return `${tps} { ${ast.fields.map((f: any) => `${f.name}: ${transpile(f.type)}`).join("; ")} }`;
    }

    case "EnumType": {
      const tps = ast.typeParams.length > 0 ? `<${ast.typeParams.join(", ")}>` : "";
      return `${tps} ${ast.variants.map((v: any) => `{ type: "${v.name}", value: ${transpile(v.type)} }`).join(" | ")}`;
    }

    case "FnType": {
      return `(arg: ${transpile(ast.param)}) => ${transpile(ast.returnType)}`;
    }

    case "ProtocolDefinition": {
      if (ast.body.type === "ProtocolBody") {
         return `export interface ${ast.id} { ${ast.body.methods.map((m: any) => `${m.name}: ${transpile(m.type)}`).join("; ")} }`;
      } else {
         return `export type ${ast.id} = ${transpile(ast.body)};`;
      }
    }

    case "ProtocolLiteral":
      return ast.protocols.join(" & ");

    case "If":
      return `((${transpile(ast.condition)}) ? (${transpile(ast.thenBranch)}) : (${transpile(ast.elseBranch)}))`;

    case "Loop":
      return `(() => { while(true) { ${transpile(ast.body)} } })()`;

    case "Call":
      return `${transpile(ast.callee)}(${transpile(ast.argument)})`;

    case "Block": {
      let code = "(() => {\n";

      if (ast.bindings && ast.bindings.length > 0) {
        for (const b of ast.bindings) {
           code += `  const ${b.id}${b.type ? `: ${transpile(b.type)}` : ""} = ${transpile(b.expr)};\n`;
        }
      }

      for (const stmt of ast.statements) {
        if (stmt.type === "ExpressionStatement") {
          code += `  ${transpile(stmt.expr)};\n`;
        } else if (stmt.type === "BreakStatement") {
          code += `  return ${transpile(stmt.expr)};\n`;
        }
      }

      code += `  return ${transpile(ast.last)};\n`;
      code += "})()";
      return code;
    }

    case "StructLiteral":
      return `{ ${ast.fields.map((f: any) => `${f.name}: ${transpile(f.value)}`).join(", ")} }`;

    case "EnumLiteral":
      return `{ type: "${ast.id}", value: ${transpile(ast.expr)} }`;

    case "PeriodAccess":
      return `${ast.head}${ast.tail.length > 0 ? "." + ast.tail.join(".") : ""}`;

    case "Identifier":
      return ast.name;

    case "StringLiteral":
      return JSON.stringify(ast.value);

    case "NumberLiteral":
      return ast.value.toString();

    case "BooleanLiteral":
      return ast.value.toString();

    default:
      throw new Error(`Unknown AST type: ${ast.type} (${JSON.stringify(ast)})`);
  }
}
