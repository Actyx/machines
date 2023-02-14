/* eslint-disable @typescript-eslint/no-non-null-assertion */
import ts from 'typescript'
import {
  buildGenerator,
  Definition,
  JsonSchemaGenerator,
  programFromConfig,
} from './typescript-json-schema.js'
import { ToEmit } from '@actyx/machine-runner'

type Ctx = {
  host: ts.FormatDiagnosticsHost
  jsg: JsonSchemaGenerator
  chk: ts.TypeChecker
  proto: ts.Symbol
  seen: Record<string, null>
  toEmit: ToEmit
}

export function proc() {
  const p = programFromConfig('./tsconfig.json')
  const jsg = buildGenerator(p)
  if (jsg === null) {
    console.error('cannot create JSON schema generator')
    process.exit(1)
  }

  const chk = p.getTypeChecker()
  const host = {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: (fileName: string) =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getNewLine: () => ts.sys.newLine,
  }
  const errors = ts.getPreEmitDiagnostics(p)
  console.error(ts.formatDiagnosticsWithColorAndContext(errors, host))
  if (errors.length > 0) {
    process.exit(1)
  }

  let proto: ts.Symbol | undefined
  for (const f of p.getSourceFiles()) {
    if (f.fileName.endsWith('machine-runner/lib/decorator.d.ts')) {
      proto = ts.forEachChild(f, findProto.bind(null, chk))
      if (proto) break
    }
  }
  if (proto === undefined) {
    console.error('cannot find `proto` function definition')
    process.exit(1)
  }
  const proto2 = proto

  const toEmit: ToEmit = {}

  for (const sourceFile of p.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      ts.forEachChild(sourceFile, (n) =>
        findEntryPoint(host, chk, jsg, sourceFile, proto2, n, toEmit),
      )
    }
  }

  return toEmit
}

function findProto(chk: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) return
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText() === 'proto') {
      return chk.getSymbolAtLocation(node.name)
    }
    return
  }
  return ts.forEachChild(node, findProto.bind(null, chk))
}

function report(
  host: ts.FormatDiagnosticsHost,
  file: ts.SourceFile,
  node: ts.Node,
  messageText: string,
) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(
      [
        {
          category: ts.DiagnosticCategory.Error,
          code: 4711,
          file,
          start: node.getStart(),
          length: node.getWidth(),
          messageText,
        },
      ],
      host,
    ),
  )
}

function traverse(ctx: Ctx, file: ts.SourceFile, protoName: string, node: ts.Node) {
  const { chk, seen, proto, host, toEmit, jsg } = ctx
  if (!ts.isClassDeclaration(node)) return
  if (!node.name) return
  const sym = chk.getSymbolAtLocation(node.name)
  if (!sym || !sym.members) return
  // prevent recursion into this same class
  seen[sym.name] = null

  const protoName2 = findDecorator(chk, node, proto)
  if (protoName2 !== protoName) {
    report(host, file, node.name, `must have 'proto' decorator with string argument '${protoName}'`)
    return
  }

  // TODO: verify that this Node is a correct State instance

  if (!toEmit[protoName].states[sym.name])
    toEmit[protoName].states[sym.name] = { events: {}, commands: {} }
  const transitions = toEmit[protoName].states[sym.name]

  // inspect all state transitions
  sym.members.forEach((mSym, mNameS) => {
    const decl = mSym.valueDeclaration! as ts.MethodDeclaration
    const mName = mNameS.toString()
    if (mName.startsWith('exec') && mName.length > 4) {
      const command = mName.slice(4)
      const t = chk.getTypeOfSymbolAtLocation(mSym, node)
      const sig = t.getCallSignatures()[0]
      const items: (Definition & { title: string } & { [k: string]: unknown })[] = []
      const events: string[] = []
      transitions.commands[command] = {
        schema: {
          title: command,
          type: 'array',
          additionalItems: false,
          items,
        },
        events,
      }
      for (const p of sig.parameters) {
        const decl = p.valueDeclaration
        if (!decl || !ts.isParameter(decl)) continue
        const typ = chk.getTypeAtLocation(decl)
        const def = jsg.getSchemaForType(typ)
        items.push({ ...def, title: p.name })
      }
      const ret = chk.getReturnTypeOfSignature(sig)
      if (ret.symbol.name.toString() !== 'Events') {
        report(host, file, decl.name, 'method does not return `Events<[...]>`')
        return
      }
      const args = (ret as ts.TypeReference).typeArguments
      if (!args || args.length !== 1) return
      const arg = args[0] as ts.TupleTypeReference
      if (arg.target.hasRestElement) {
        report(host, file, decl.name, 'method cannot return variadic tuple type')
        return
      }
      try {
        events.push(
          ...arg.typeArguments!.map((t, idx) => {
            const prop = t.getProperty('type')
            if (!prop) {
              report(host, file, decl.name, `missing 'type' property in event index ${idx}`)
              throw 1
            }
            const type = chk.getTypeOfSymbolAtLocation(prop, decl)
            if (!type.isStringLiteral()) {
              report(
                host,
                file,
                prop.valueDeclaration || decl,
                'property `type` must be a string literal type',
              )
              throw 2
            }
            return type.value
          }),
        )
      } catch (_e) {
        return
      }
    } else if (mName.startsWith('on') && mName.length > 2) {
      const event = mName.slice(2)
      const t = chk.getTypeOfSymbolAtLocation(mSym, node)
      const call = t.getCallSignatures()[0]
      const ret = chk.getReturnTypeOfSignature(call)
      const nextState = ret.symbol.name.toString()
      const events: string[] = []
      for (const p of call.parameters) {
        const typ = chk.getTypeOfSymbolAtLocation(p, decl)
        const prop = typ.getProperty('type')
        if (!prop) {
          report(host, file, p.valueDeclaration!, 'missing `type` property')
          return
        }
        const type = chk.getTypeOfSymbolAtLocation(prop, decl)
        if (!type.isStringLiteral()) {
          report(
            host,
            file,
            prop.valueDeclaration || p.valueDeclaration!,
            '`type` property must be a string literal type',
          )
          return
        }
        events.push(type.value)
      }
      if (events[0] !== event) {
        report(host, file, decl.name, 'method name must match first event type')
        return
      }
      transitions.events[events[0]] = { moreEvents: events.slice(1), target: ret.symbol.name }

      if (!(ret.symbol.name in seen)) traverse(ctx, file, protoName, ret.symbol.valueDeclaration!)
    }
  })
}

function findDecorator(chk: ts.TypeChecker, node: ts.ClassDeclaration, proto: ts.Symbol) {
  const [decorator] = ts.getDecorators(node) || []
  if (!decorator) return
  if (!ts.isCallExpression(decorator.expression)) return
  const target = decorator.expression.expression
  if (!ts.isIdentifier(target)) return
  const sym = chk.getSymbolAtLocation(target)
  if (!sym) return
  const sym2 = chk.getAliasedSymbol(sym)
  if (sym2 !== proto) return
  const [arg] = decorator.expression.arguments
  return ts.isStringLiteral(arg) && arg.text
}

const DocCommentMarker = 'Initial state for role '

function findEntryPoint(
  host: ts.FormatDiagnosticsHost,
  chk: ts.TypeChecker,
  jsg: JsonSchemaGenerator,
  file: ts.SourceFile,
  proto: ts.Symbol,
  node: ts.Node,
  toEmit: ToEmit,
) {
  if (ts.isClassDeclaration(node) && node.name) {
    const sym = chk.getSymbolAtLocation(node.name)
    if (sym === undefined) return
    const comment = ts.displayPartsToString(sym.getDocumentationComment(undefined))
    if (!comment.startsWith(DocCommentMarker)) return
    const role = comment.slice(DocCommentMarker.length).split('\n', 2)[0]

    const protoName = findDecorator(chk, node, proto)
    if (!protoName) {
      report(host, file, node.name, 'must have `proto` decorator with string literal')
      return
    }

    console.log(`found initial state ${sym.name} for protocol ${protoName} / role ${role}`)

    if (!toEmit[protoName]) toEmit[protoName] = { entrypoints: [], states: {} }
    toEmit[protoName].entrypoints.push({
      state: node.name.text,
      role: comment.slice(DocCommentMarker.length).split('\n', 2)[0],
    })
    const ctx = { host, chk, jsg, proto, toEmit, seen: {} }
    traverse(ctx, file, protoName, node)
  } else {
    ts.forEachChild(node, (n) => findEntryPoint(host, chk, jsg, file, proto, n, toEmit))
  }
}
