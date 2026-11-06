use super::*;

fn nodes(src: &str) -> Vec<Node> {
    parse(src).into_iter().map(|b| b.node).collect()
}
fn t(s: &str) -> Inline {
    Inline::Text(s.into())
}

#[test]
fn blocks_and_inlines() {
    let n = nodes("# Title\n\nSome **bold**, *it*, ~~gone~~ and `code`.\n\n---\n");
    assert_eq!(n[0], Node::Heading(1, vec![t("Title")]));
    assert_eq!(
        n[1],
        Node::Para(vec![
            t("Some "),
            Inline::Strong(vec![t("bold")]),
            t(", "),
            Inline::Em(vec![t("it")]),
            t(", "),
            Inline::Strike(vec![t("gone")]),
            t(" and "),
            Inline::Code("code".into()),
            t("."),
        ])
    );
    assert_eq!(n[2], Node::Rule);
}

#[test]
fn fenced_code_keeps_lang_and_text() {
    let n = nodes("```rust\nfn x() {}\n```\n");
    assert_eq!(
        n[0],
        Node::Code {
            lang: "rust".into(),
            text: "fn x() {}".into()
        }
    );
    // Unclosed while streaming: still a code block.
    let n = nodes("```py\nprint(1)\npri");
    assert_eq!(
        n[0],
        Node::Code {
            lang: "py".into(),
            text: "print(1)\npri".into()
        }
    );
}

#[test]
fn task_and_nested_lists() {
    let n = nodes("- [x] done\n- [ ] todo\n  - inner\n\n3. three\n4. four\n");
    let Node::List { start: None, items } = &n[0] else {
        panic!("{n:?}")
    };
    assert_eq!(items[0].task, Some(true));
    assert_eq!(items[1].task, Some(false));
    assert!(matches!(items[1].children[1], Node::List { .. }));
    assert!(matches!(n[1], Node::List { start: Some(3), .. }));
}

#[test]
fn tables() {
    let n = nodes("| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 |\n");
    let Node::Table { align, head, rows } = &n[0] else {
        panic!("{n:?}")
    };
    assert_eq!(align, &vec![Align::Left, Align::Right]);
    assert_eq!(head, &vec![vec![t("a")], vec![t("b")]]);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0][1], vec![t("2")]);
}

#[test]
fn links_autolinks_images() {
    let n = nodes("See [docs](https://x.dev) or https://frogg.app/a, ok ![pic](img.png)");
    let Node::Para(i) = &n[0] else { panic!() };
    assert_eq!(
        i[1],
        Inline::Link {
            href: "https://x.dev".into(),
            children: vec![t("docs")]
        }
    );
    assert_eq!(
        i[3],
        Inline::Link {
            href: "https://frogg.app/a".into(),
            children: vec![t("https://frogg.app/a")]
        }
    );
    assert_eq!(i[4], t(", ok "));
    assert_eq!(
        i[5],
        Inline::Image {
            src: "img.png".into(),
            alt: "pic".into()
        }
    );
}

#[test]
fn streaming_keeps_earlier_block_keys() {
    let a = parse("para one\n\npara tw");
    let b = parse("para one\n\npara two and more");
    assert_eq!((a[0].index, a[0].hash), (b[0].index, b[0].hash));
    assert_ne!(a[1].hash, b[1].hash);
}

#[test]
fn hrefs_and_images() {
    assert_eq!(safe_href("https://a"), Some("https://a"));
    assert_eq!(safe_href("javascript:alert(1)"), None);
    assert_eq!(safe_href("/etc/passwd"), None);
    assert_eq!(
        resolve_image("https://x/y.png", None),
        Some(ImageSource::Uri("https://x/y.png".into()))
    );
    assert_eq!(
        resolve_image("file:///C:/a%20b.png", None),
        Some(ImageSource::Host {
            cwd: "C:/".into(),
            path: "C:/a b.png".into()
        })
    );
    assert_eq!(
        resolve_image("./shot.png", Some("/repo")),
        Some(ImageSource::Host {
            cwd: "/repo".into(),
            path: "shot.png".into()
        })
    );
    assert_eq!(resolve_image("shot.png", None), None);
    assert_eq!(resolve_image("ftp://x", None), None);
    assert_eq!(
        resolve_image("~/x.png", None),
        Some(ImageSource::Host {
            cwd: "~".into(),
            path: "~/x.png".into()
        })
    );
}

#[test]
fn table_column_widths() {
    let n =
        nodes("| a | description |\n|---|:---:|\n| `xy` | **a much longer cell here** |\n| z |\n");
    let Node::Table { head, rows, .. } = &n[0] else {
        panic!("not a table: {n:?}")
    };
    // Short columns hold the minimum; widths come from plain text (markup does not count).
    let w = column_widths(head, rows);
    assert_eq!(w, vec![56, (23.0f64 * 7.4 + 24.0).round() as u32]);
    // Very long cells cap at the maximum; ragged rows widen the column count.
    let long = vec![vec![Inline::Text("x".repeat(500))], vec![t("b")]];
    assert_eq!(column_widths(&[vec![t("h")]], &[long]), vec![300, 56]);
}

#[test]
fn table_cells_keep_inline_markdown() {
    let n = nodes("| a |\n|---|\n| **b** [l](https://x.y) |\n");
    let Node::Table { rows, .. } = &n[0] else {
        panic!()
    };
    assert_eq!(rows[0][0][0], Inline::Strong(vec![t("b")]));
    assert!(matches!(rows[0][0][2], Inline::Link { .. }));
}

#[test]
fn base64_and_data_urls() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    assert_eq!(data_url("image/png", b"hi"), "data:image/png;base64,aGk=");
}

#[test]
fn host_image_checks() {
    assert_eq!(
        image_data_url("image/png", b"hi").as_deref(),
        Ok("data:image/png;base64,aGk=")
    );
    assert_eq!(
        image_data_url("text/plain", b"hi"),
        Err("Not an image".to_owned())
    );
    let big = vec![0u8; MAX_IMAGE_BYTES + 1];
    assert_eq!(
        image_data_url("image/png", &big),
        Err("Image too large to preview".to_owned())
    );
}

#[test]
fn image_inline_in_paragraph() {
    let n = nodes("see ![shot](./a.png) here");
    assert_eq!(
        n[0],
        Node::Para(vec![
            t("see "),
            Inline::Image {
                src: "./a.png".into(),
                alt: "shot".into()
            },
            t(" here"),
        ])
    );
}
