//! Port of `compat/normalize-provider-models.ts` and `provider-snapshot-codec.ts`: the client
//! advertises `compactProviderSnapshots`, so snapshot payloads may arrive compacted and are
//! expanded here before anyone decodes them.

use serde_json::{Map, Value};

/// Expands `payload.compactSnapshot` into `payload.entries`, or fills each model's
/// `defaultThinkingOptionId` from its `isDefault` thinking option. Returns `None` when the
/// message needs no change.
pub fn provider_snapshot_message(message: &Value) -> Option<Value> {
    let payload = message.get("payload")?.as_object()?;
    let entries = match payload.get("compactSnapshot") {
        Some(compact) if !compact.is_null() => expand(compact)?,
        _ => {
            let entries = payload.get("entries")?.as_array()?;
            let mut changed = false;
            let next: Vec<Value> = entries
                .iter()
                .map(|e| match normalize_entry(e) {
                    Some(n) => {
                        changed = true;
                        n
                    }
                    None => e.clone(),
                })
                .collect();
            if !changed {
                return None;
            }
            next
        }
    };
    let mut out = message.clone();
    out["payload"]["entries"] = Value::Array(entries);
    Some(out)
}

fn normalize_entry(entry: &Value) -> Option<Value> {
    let models = entry.get("models")?.as_array()?;
    let mut changed = false;
    let next: Vec<Value> = models
        .iter()
        .map(|m| match normalize_model(m) {
            Some(n) => {
                changed = true;
                n
            }
            None => m.clone(),
        })
        .collect();
    if !changed {
        return None;
    }
    let mut e = entry.clone();
    e["models"] = Value::Array(next);
    Some(e)
}

fn normalize_model(model: &Value) -> Option<Value> {
    if model
        .get("defaultThinkingOptionId")
        .is_some_and(|v| !v.is_null())
    {
        return None;
    }
    let id = model
        .get("thinkingOptions")?
        .as_array()?
        .iter()
        .find(|o| o.get("isDefault") == Some(&Value::Bool(true)))?
        .get("id")?
        .clone();
    let mut m = model.clone();
    m["defaultThinkingOptionId"] = id;
    Some(m)
}

fn expand(compact: &Value) -> Option<Vec<Value>> {
    let sets = compact.get("thinkingSets").and_then(Value::as_array);
    let entries = compact.get("entries")?.as_array()?;
    entries
        .iter()
        .map(|entry| {
            let mut e: Map<String, Value> = entry.as_object()?.clone();
            let provider = e.get("provider").cloned().unwrap_or(Value::Null);
            if let Some(models) = e.remove("models") {
                let models = models
                    .as_array()?
                    .iter()
                    .map(|m| {
                        let mut m = m.as_object()?.clone();
                        let set = m.remove("thinkingSet");
                        let mut out = Map::new();
                        out.insert("provider".into(), provider.clone());
                        out.extend(m);
                        if let Some(index) = set.and_then(|s| s.as_u64()) {
                            let set = sets?.get(index as usize)?;
                            out.insert(
                                "thinkingOptions".into(),
                                set.get("options").cloned().unwrap_or(Value::Array(vec![])),
                            );
                            if let Some(d) = set.get("defaultOptionId") {
                                out.insert("defaultThinkingOptionId".into(), d.clone());
                            }
                        }
                        Some(Value::Object(out))
                    })
                    .collect::<Option<Vec<_>>>()?;
                e.insert("models".into(), Value::Array(models));
            }
            Some(Value::Object(e))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn expands_compact_snapshots() {
        let msg = json!({"type":"providers_snapshot_update","payload":{
        "entries":[],
        "compactSnapshot":{
            "entries":[{"provider":"claude","status":"ready","enabled":true,
                "models":[{"id":"m1","label":"M1","thinkingSet":0},{"id":"m2","label":"M2"}]}],
            "thinkingSets":[{"options":[{"id":"hi","label":"High"}],"defaultOptionId":"hi"}]
        }}});
        let out = provider_snapshot_message(&msg).unwrap();
        let models = &out["payload"]["entries"][0]["models"];
        assert_eq!(models[0]["provider"], "claude");
        assert_eq!(models[0]["thinkingOptions"][0]["id"], "hi");
        assert_eq!(models[0]["defaultThinkingOptionId"], "hi");
        assert!(models[0].get("thinkingSet").is_none());
        assert!(models[1].get("thinkingOptions").is_none());
    }

    #[test]
    fn fills_default_thinking_option() {
        let msg = json!({"payload":{"entries":[{"provider":"p","models":[
            {"id":"m","thinkingOptions":[{"id":"a"},{"id":"b","isDefault":true}]}]}]}});
        let out = provider_snapshot_message(&msg).unwrap();
        assert_eq!(
            out["payload"]["entries"][0]["models"][0]["defaultThinkingOptionId"],
            "b"
        );
        assert!(provider_snapshot_message(&out).is_none());
    }
}
