use crate::ast::*;
use crate::lexer::Token;
use chumsky::prelude::*;

type ParserExtra<'a> = extra::Err<Rich<'a, Token>>;

pub fn type_literal_parser<'a>() -> Boxed<'a, 'a, &'a [Token], TypeLiteral, ParserExtra<'a>> {
    recursive(|type_literal| {
        let ident = select! { Token::Identifier(i) => i };

        let reference = just(Token::Dollar)
            .ignore_then(ident)
            .then(
                type_literal
                    .clone()
                    .separated_by(just(Token::Comma))
                    .collect::<Vec<_>>()
                    .delimited_by(just(Token::LAngle), just(Token::RAngle))
                    .or_not(),
            )
            .map(|(name, args)| TypeLiteral::Reference {
                name,
                args: args.unwrap_or_default(),
            });

        let struct_body = just(Token::Dollar)
            .ignore_then(ident.repeated().collect::<Vec<_>>())
            .then_ignore(just(Token::FatArrow))
            .then(
                ident
                    .then_ignore(just(Token::Eq))
                    .then(type_literal.clone())
                    .repeated()
                    .collect::<Vec<_>>()
                    .delimited_by(just(Token::LBrace), just(Token::RBrace)),
            )
            .map(|(generics, fields)| {
                TypeLiteral::Struct(StructTypeBody {
                    generics,
                    fields,
                })
            });

        let enum_body = just(Token::Dollar)
            .ignore_then(ident.repeated().collect::<Vec<_>>())
            .then_ignore(just(Token::FatArrow))
            .then(
                ident
                    .then_ignore(just(Token::Eq))
                    .then(type_literal.clone())
                    .repeated()
                    .collect::<Vec<_>>()
                    .delimited_by(just(Token::Pipe), just(Token::Pipe)),
            )
            .map(|(generics, variants)| {
                TypeLiteral::Enum(EnumTypeBody {
                    generics,
                    variants,
                })
            });

        let base_type = choice((
            struct_body,
            enum_body,
            reference,
        )).boxed();

        base_type
            .clone()
            .then(just(Token::RAngle).ignore_then(type_literal.clone()).repeated().collect::<Vec<_>>())
            .map(|(first, rest)| {
                if rest.is_empty() {
                    first
                } else {
                    let all = std::iter::once(first).chain(rest).collect::<Vec<_>>();
                    let mut it = all.into_iter().rev();
                    let mut current = it.next().unwrap();
                    for param in it {
                        current = TypeLiteral::Fn(FnTypeBody {
                            constraints: vec![],
                            param_ty: Box::new(param),
                            return_ty: Box::new(current),
                        });
                    }
                    current
                }
            })
            .boxed()
    })
    .boxed()
}

pub fn expression_parser<'a>(
    type_literal: Boxed<'a, 'a, &'a [Token], TypeLiteral, ParserExtra<'a>>,
) -> Boxed<'a, 'a, &'a [Token], Expression, ParserExtra<'a>> {
    recursive(|expr| {
        let ident = select! { Token::Identifier(i) => i };
        let int = select! { Token::IntLiteral(i) => i };
        let float = select! { Token::FloatLiteral(f) => f };
        let string = select! { Token::StringLiteral(s) => s };

        let literal = choice((
            int.map(|i| PrimaryExpression::Literal(Literal::Int(i))),
            float.map(|f| PrimaryExpression::Literal(Literal::Float(f))),
            string.map(|s| PrimaryExpression::Literal(Literal::String(s))),
        ));

        let ident_based = ident.then(
            choice((
                ident
                    .then_ignore(just(Token::Eq))
                    .then(expr.clone())
                    .repeated()
                    .collect::<Vec<_>>()
                    .delimited_by(just(Token::LBrace), just(Token::RBrace))
                    .map(|fields| {
                        Box::new(move |name| PrimaryExpression::StructLiteral { name, fields }) as Box<dyn FnOnce(String) -> PrimaryExpression>
                    }),
                expr.clone()
                    .delimited_by(just(Token::LParen), just(Token::RParen))
                    .map(|arg| {
                        Box::new(move |name| PrimaryExpression::EnumLiteral { name, arg: Box::new(arg) }) as Box<dyn FnOnce(String) -> PrimaryExpression>
                    }),
                just(Token::Dot)
                    .ignore_then(ident.separated_by(just(Token::Dot)).collect::<Vec<_>>())
                    .map(|rest| {
                        Box::new(move |name| {
                            let mut parts = vec![name];
                            parts.extend(rest);
                            PrimaryExpression::PeriodAccess(parts)
                        }) as Box<dyn FnOnce(String) -> PrimaryExpression>
                    }),
                empty().map(|_| {
                    Box::new(move |name| PrimaryExpression::PeriodAccess(vec![name])) as Box<dyn FnOnce(String) -> PrimaryExpression>
                })
            ))
        ).map(|(name, f)| f(name));

        let primary = choice((
            literal.clone(),
            ident_based.clone(),
        )).map(Expression::Primary);

        let paren_expr = expr
            .clone()
            .delimited_by(just(Token::LParen), just(Token::RParen))
            .map(|e| Expression::Paren(Box::new(e)));

        let atom = choice((
            just(Token::If)
                .ignore_then(expr.clone())
                .then_ignore(just(Token::Then))
                .then(expr.clone())
                .then_ignore(just(Token::Else))
                .then(expr.clone())
                .map(|((cond, then), els)| Expression::If {
                    cond: Box::new(cond),
                    then: Box::new(then),
                    els: Box::new(els),
                }),
            just(Token::Loop)
                .ignore_then(expr.clone())
                .map(|e| Expression::Loop(Box::new(e))),
            just(Token::Do)
                .ignore_then(
                    choice((
                        just(Token::Break)
                            .ignore_then(expr.clone())
                            .map(BlockStmt::Break),
                        expr.clone().then_ignore(just(Token::Semicolon)).map(BlockStmt::Expr),
                    ))
                    .repeated()
                    .collect::<Vec<_>>()
                    .then(expr.clone())
                    .delimited_by(just(Token::LBrace), just(Token::RBrace))
                )
                .then_ignore(just(Token::Where))
                .then(
                    ident
                        .then(just(Token::Colon).ignore_then(type_literal.clone()).or_not())
                        .then_ignore(just(Token::Eq))
                        .then(expr.clone())
                        .map(|((name, ty), expr)| Binding { name, ty, expr })
                        .repeated()
                        .collect::<Vec<_>>()
                        .delimited_by(just(Token::LBrace), just(Token::RBrace))
                )
                .map(|((stmts, result), bindings)| {
                    Expression::Block(BlockExpression {
                        stmts,
                        result: Box::new(result),
                        bindings,
                    })
                }),
            primary,
            paren_expr.clone(),
        ));

        atom.foldl(
            choice((literal, ident_based))
                .map(Expression::Primary)
                .or(paren_expr)
                .repeated(),
            |func, arg| Expression::Call {
                func: Box::new(func),
                arg: Box::new(arg),
            },
        )
    })
    .boxed()
}

pub fn parser<'a>() -> Boxed<'a, 'a, &'a [Token], Vec<TopLevel>, ParserExtra<'a>> {
    let type_literal = type_literal_parser();
    let expression = expression_parser(type_literal.clone());
    let ident = select! { Token::Identifier(i) => i };
    let string = select! { Token::StringLiteral(s) => s };

    let protocol_literal = just(Token::Caret)
        .ignore_then(ident)
        .separated_by(just(Token::Plus))
        .at_least(1)
        .collect::<Vec<_>>();

    let protocol_def_body = choice((
        ident
            .then_ignore(just(Token::Eq))
            .then(type_literal.clone().map(|t| match t {
                TypeLiteral::Fn(f) => f,
                _ => {
                    FnTypeBody {
                        constraints: vec![],
                        param_ty: Box::new(t),
                        return_ty: Box::new(TypeLiteral::Reference { name: "Error".to_string(), args: vec![] }),
                    }
                }
            }))
            .repeated()
            .collect::<Vec<_>>()
            .delimited_by(just(Token::LBrace), just(Token::RBrace))
            .map(ProtocolDefinitionBody::Methods),
        protocol_literal.map(ProtocolDefinitionBody::Literal)
    ));

    let using = just(Token::Using)
        .ignore_then(
            ident
                .then(just(Token::As).ignore_then(ident).or_not())
                .repeated()
                .collect::<Vec<(String, Option<String>)>>(),
        )
        .then_ignore(just(Token::From))
        .then(string)
        .then_ignore(just(Token::Semicolon))
        .map(|(parts, from)| {
            TopLevel::Using(Using {
                parts,
                from,
            })
        });

    let function = ident
        .then(
            just(Token::Dollar)
                .ignore_then(ident)
                .then_ignore(just(Token::Colon))
                .then(protocol_def_body.clone())
                .map(|(name, body)| ProtocolConstraint { name, body })
                .repeated()
                .collect::<Vec<_>>()
                .then_ignore(just(Token::FatArrow))
                .or_not(),
        )
        .then(
            ident
                .then_ignore(just(Token::Colon))
                .then(type_literal.clone())
                .map(|(name, ty)| ParamDef { name, ty })
                .repeated()
                .collect::<Vec<ParamDef>>()
        )
        .then(
            just(Token::RAngle)
            .ignore_then(type_literal.clone())
            .then_ignore(just(Token::Is))
            .then(choice((
                just(Token::Hash)
                    .ignore_then(ident)
                    .map(FunctionBody::Intrinsic),
                expression.clone().map(FunctionBody::Expr),
            )))
        )
        .then_ignore(just(Token::Semicolon))
        .map(|(((name, protocol_defs), params), (return_type, body))| {
            TopLevel::Function(Function {
                name,
                protocol_defs: protocol_defs.unwrap_or_default(),
                params,
                return_type,
                body,
            })
        });

    let type_definition = just(Token::Dollar)
        .ignore_then(ident)
        .then_ignore(just(Token::Is))
        .then(type_literal.clone())
        .then_ignore(just(Token::Semicolon))
        .map(|(name, ty)| TopLevel::TypeDefinition(TypeDefinition { name, ty }));

    let protocol_definition = just(Token::Caret)
        .ignore_then(ident)
        .then_ignore(just(Token::Is))
        .then(protocol_def_body)
        .then_ignore(just(Token::Semicolon))
        .map(|(name, body)| TopLevel::ProtocolDefinition(ProtocolDefinition { name, body }));

    choice((using, function, type_definition, protocol_definition))
        .repeated()
        .collect::<Vec<_>>()
        .boxed()
}
