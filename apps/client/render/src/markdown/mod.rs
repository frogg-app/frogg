//! `Markdown`: GFM rendered with Leptos, after ui-next's `Markdown.tsx` and `markdown/`.
//! Streaming-friendly: the text is re-parsed on change (pulldown-cmark is fast) but top-level
//! blocks are keyed by a hash of their source, so only changed blocks touch the DOM.

mod parse;

pub use parse::{
    linkify, parse, plain_text, resolve_image, safe_href, Align, Block, ImageSource, Inline, Item,
    Node,
};

use crate::code::CodeFence;
use leptos::prelude::*;

#[derive(Clone, Copy)]
struct Ctx {
    on_link: Option<Callback<String>>,
    image_src: Option<Callback<String, Option<String>>>,
}

/// Rendered markdown.
///
/// - `on_link`: called with the href when a (web or mail) link is clicked, instead of the
///   browser following it. Without it links open in a new tab.
/// - `image_src`: maps an image `src` that is not a direct URL (a host path, `file://`) to a
///   loadable URL, e.g. a blob URL fetched through the daemon. See [`resolve_image`].
#[component]
pub fn Markdown(
    #[prop(into)] text: Signal<String>,
    #[prop(optional, into)] on_link: Option<Callback<String>>,
    #[prop(optional, into)] image_src: Option<Callback<String, Option<String>>>,
) -> impl IntoView {
    let ctx = Ctx { on_link, image_src };
    let blocks = Memo::new(move |_| text.with(|t| parse(t)));
    view! {
        <div class="fr-md">
            <For
                each=move || blocks.get()
                key=|b| (b.index, b.hash)
                children=move |b| node_view(&b.node, ctx)
            />
        </div>
    }
}

fn nodes_view(nodes: &[Node], ctx: Ctx) -> AnyView {
    nodes
        .iter()
        .map(|n| node_view(n, ctx))
        .collect_view()
        .into_any()
}

fn node_view(node: &Node, ctx: Ctx) -> AnyView {
    match node {
        Node::Para(i) => view! { <p>{inlines_view(i, ctx)}</p> }.into_any(),
        Node::Plain(i) => {
            view! { <div class="fr-md-plain">{inlines_view(i, ctx)}</div> }.into_any()
        }
        Node::Heading(level, i) => {
            let body = inlines_view(i, ctx);
            match level {
                1 => view! { <h1>{body}</h1> }.into_any(),
                2 => view! { <h2>{body}</h2> }.into_any(),
                3 => view! { <h3>{body}</h3> }.into_any(),
                4 => view! { <h4>{body}</h4> }.into_any(),
                5 => view! { <h5>{body}</h5> }.into_any(),
                _ => view! { <h6>{body}</h6> }.into_any(),
            }
        }
        Node::Code { lang, text } => {
            view! { <CodeFence code=text.clone() lang=lang.clone() /> }.into_any()
        }
        Node::Quote(children) => {
            view! { <blockquote>{nodes_view(children, ctx)}</blockquote> }.into_any()
        }
        Node::List { start, items } => {
            let items = items
                .iter()
                .map(|it| {
                    let task = it.task;
                    let mark = task.map(|done| {
                        view! { <span class="fr-md-task" class:done=done aria-hidden="true">{if done { "☑" } else { "☐" }}</span> }
                    });
                    view! {
                        <li class:fr-md-task-item=task.is_some()>
                            {mark}
                            <div class="fr-md-li">{nodes_view(&it.children, ctx)}</div>
                        </li>
                    }
                })
                .collect_view();
            match start {
                Some(s) => {
                    view! { <ol start=*s style=format!("--start:{s}")>{items}</ol> }.into_any()
                }
                None => view! { <ul>{items}</ul> }.into_any(),
            }
        }
        Node::Table { align, head, rows } => {
            let style = |n: usize| match align.get(n).copied().unwrap_or(Align::None) {
                Align::Center => "text-align:center",
                Align::Right => "text-align:right",
                _ => "text-align:left",
            };
            let head = head
                .iter()
                .enumerate()
                .map(|(n, c)| view! { <th style=style(n)>{inlines_view(c, ctx)}</th> })
                .collect_view();
            let ncols = align.len();
            let rows = rows
                .iter()
                .map(|r| {
                    let cells = (0..ncols.max(r.len()))
                        .map(|n| {
                            let c = r.get(n).map(|c| inlines_view(c, ctx));
                            view! { <td style=style(n)>{c}</td> }
                        })
                        .collect_view();
                    view! { <tr>{cells}</tr> }
                })
                .collect_view();
            view! {
                <div class="fr-md-table">
                    <table>
                        <thead><tr>{head}</tr></thead>
                        <tbody>{rows}</tbody>
                    </table>
                </div>
            }
            .into_any()
        }
        Node::Rule => view! { <hr /> }.into_any(),
        Node::Cell(_) | Node::Row(_) | Node::ItemNode(_) => ().into_any(),
    }
}

fn inlines_view(inlines: &[Inline], ctx: Ctx) -> AnyView {
    inlines
        .iter()
        .map(|i| inline_view(i, ctx))
        .collect_view()
        .into_any()
}

fn inline_view(inline: &Inline, ctx: Ctx) -> AnyView {
    match inline {
        Inline::Text(t) => t.clone().into_any(),
        Inline::Code(t) => view! { <code>{t.clone()}</code> }.into_any(),
        Inline::Strong(c) => view! { <strong>{inlines_view(c, ctx)}</strong> }.into_any(),
        Inline::Em(c) => view! { <em>{inlines_view(c, ctx)}</em> }.into_any(),
        Inline::Strike(c) => view! { <del>{inlines_view(c, ctx)}</del> }.into_any(),
        Inline::Break => view! { <br /> }.into_any(),
        Inline::Link { href, children } => match safe_href(href) {
            None => inlines_view(children, ctx),
            Some(href) => {
                let target = href.to_string();
                let click = move |ev: web_sys::MouseEvent| {
                    if let Some(cb) = ctx.on_link {
                        ev.prevent_default();
                        cb.run(target.clone());
                    }
                };
                view! {
                    <a href=href.to_string() target="_blank" rel="noreferrer" on:click=click>
                        {inlines_view(children, ctx)}
                    </a>
                }
                .into_any()
            }
        },
        Inline::Image { src, alt } => {
            let url = match resolve_image(src, None) {
                Some(ImageSource::Uri(u)) => Some(u),
                _ => ctx.image_src.and_then(|cb| cb.run(src.clone())),
            };
            match url {
                Some(u) => view! { <img class="fr-md-img" src=u alt=alt.clone() loading="lazy" /> }
                    .into_any(),
                None => {
                    view! { <span class="fr-md-img-missing" title=src.clone()>{alt.clone()}</span> }
                        .into_any()
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
