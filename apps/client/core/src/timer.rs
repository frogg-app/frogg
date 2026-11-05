//! Timers behind a trait, so the client's timeouts, backoff and heartbeat run on `setTimeout`
//! in the browser and on a manually driven clock in native tests.

use std::cell::RefCell;
use std::rc::Rc;

pub type TimerId = u64;

pub trait Scheduler {
    /// Runs `f` once after `ms` milliseconds unless cleared first.
    fn set_timeout(&self, ms: u64, f: Box<dyn FnOnce()>) -> TimerId;
    fn clear_timeout(&self, id: TimerId);
    /// Monotonic milliseconds, for round-trip measurements.
    fn now_ms(&self) -> f64;
}

/// A clock that only moves when told to. Tests call [`ManualScheduler::advance`]; a native
/// event loop can call [`ManualScheduler::run_due_realtime`] to follow the wall clock.
#[derive(Clone, Default)]
pub struct ManualScheduler {
    inner: Rc<RefCell<ManualInner>>,
}

/// id, due time, callback.
type ManualTimer = (TimerId, u64, Box<dyn FnOnce()>);

#[derive(Default)]
struct ManualInner {
    now: u64,
    next_id: TimerId,
    timers: Vec<ManualTimer>,
    #[cfg(not(target_arch = "wasm32"))]
    started: Option<std::time::Instant>,
}

impl ManualScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn now(&self) -> u64 {
        self.inner.borrow().now
    }

    pub fn pending(&self) -> usize {
        self.inner.borrow().timers.len()
    }

    /// Moves the clock forward, firing every timer that falls due (in due order, including
    /// timers scheduled by the callbacks themselves).
    pub fn advance(&self, ms: u64) {
        let target = self.inner.borrow().now + ms;
        self.run_until(target);
    }

    fn run_until(&self, target: u64) {
        loop {
            let next = {
                let mut inner = self.inner.borrow_mut();
                let due = inner
                    .timers
                    .iter()
                    .enumerate()
                    .filter(|(_, (_, at, _))| *at <= target)
                    .min_by_key(|(_, (id, at, _))| (*at, *id))
                    .map(|(i, _)| i);
                match due {
                    Some(i) => {
                        let (_, at, f) = inner.timers.remove(i);
                        inner.now = inner.now.max(at);
                        Some(f)
                    }
                    None => {
                        inner.now = target;
                        None
                    }
                }
            };
            match next {
                Some(f) => f(),
                None => break,
            }
        }
    }

    /// Fires timers that are due by the real elapsed time since the first call.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn run_due_realtime(&self) {
        let elapsed = {
            let mut inner = self.inner.borrow_mut();
            let started = *inner.started.get_or_insert_with(std::time::Instant::now);
            started.elapsed().as_millis() as u64
        };
        if elapsed > self.now() {
            self.run_until(elapsed);
        }
    }
}

impl Scheduler for ManualScheduler {
    fn set_timeout(&self, ms: u64, f: Box<dyn FnOnce()>) -> TimerId {
        let mut inner = self.inner.borrow_mut();
        inner.next_id += 1;
        let id = inner.next_id;
        let at = inner.now + ms;
        inner.timers.push((id, at, f));
        id
    }

    fn clear_timeout(&self, id: TimerId) {
        self.inner.borrow_mut().timers.retain(|(i, _, _)| *i != id);
    }

    fn now_ms(&self) -> f64 {
        self.inner.borrow().now as f64
    }
}

#[cfg(target_arch = "wasm32")]
pub use browser::BrowserScheduler;

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::*;
    use std::collections::HashMap;
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;

    type Slot = Rc<RefCell<Option<Box<dyn FnOnce()>>>>;

    /// `window.setTimeout`. Closures live in a map until they fire or are cleared; a fired
    /// closure is dropped on the next scheduler call, never from inside its own invocation.
    #[derive(Clone, Default)]
    pub struct BrowserScheduler {
        inner: Rc<RefCell<BrowserInner>>,
    }

    #[derive(Default)]
    struct BrowserInner {
        // timer id -> (browser handle, closure)
        #[allow(clippy::type_complexity)]
        live: HashMap<TimerId, (i32, Closure<dyn FnMut()>)>,
        spent: Vec<Closure<dyn FnMut()>>,
        firing: bool,
    }

    impl BrowserInner {
        fn sweep(&mut self) {
            if !self.firing {
                self.spent.clear();
            }
        }
    }

    impl BrowserScheduler {
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl Scheduler for BrowserScheduler {
        fn set_timeout(&self, ms: u64, f: Box<dyn FnOnce()>) -> TimerId {
            thread_local!(static NEXT: std::cell::Cell<TimerId> = const { std::cell::Cell::new(0) });
            let id = NEXT.with(|n| {
                n.set(n.get() + 1);
                n.get()
            });
            self.inner.borrow_mut().sweep();
            let slot: Slot = Rc::new(RefCell::new(Some(f)));
            let weak = Rc::downgrade(&self.inner);
            let closure = Closure::<dyn FnMut()>::new({
                let slot = slot.clone();
                move || {
                    let inner = weak.upgrade();
                    if let Some(inner) = &inner {
                        let mut inner = inner.borrow_mut();
                        if let Some((_, c)) = inner.live.remove(&id) {
                            inner.spent.push(c);
                        }
                        inner.firing = true;
                    }
                    let f = slot.borrow_mut().take();
                    if let Some(f) = f {
                        f();
                    }
                    if let Some(inner) = &inner {
                        inner.borrow_mut().firing = false;
                    }
                }
            });
            let handle = web_sys::window()
                .and_then(|w| {
                    w.set_timeout_with_callback_and_timeout_and_arguments_0(
                        closure.as_ref().unchecked_ref(),
                        ms.min(i32::MAX as u64) as i32,
                    )
                    .ok()
                })
                .unwrap_or(-1);
            self.inner.borrow_mut().live.insert(id, (handle, closure));
            id
        }

        fn clear_timeout(&self, id: TimerId) {
            let entry = self.inner.borrow_mut().live.remove(&id);
            if let Some((handle, closure)) = entry {
                if let Some(w) = web_sys::window() {
                    w.clear_timeout_with_handle(handle);
                }
                self.inner.borrow_mut().spent.push(closure);
            }
        }

        fn now_ms(&self) -> f64 {
            web_sys::window()
                .and_then(|w| w.performance())
                .map(|p| p.now())
                .unwrap_or_else(js_sys::Date::now)
        }
    }
}

/// The scheduler a client gets when none is given: `setTimeout` in the browser, a manual
/// clock natively (timers then fire only when driven).
pub fn default_scheduler() -> Rc<dyn Scheduler> {
    #[cfg(target_arch = "wasm32")]
    {
        Rc::new(BrowserScheduler::new())
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        Rc::new(ManualScheduler::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fires_in_order_and_respects_clear() {
        let s = ManualScheduler::new();
        let log = Rc::new(RefCell::new(Vec::new()));
        let l = log.clone();
        s.set_timeout(20, Box::new(move || l.borrow_mut().push(20)));
        let l = log.clone();
        let cleared = s.set_timeout(5, Box::new(move || l.borrow_mut().push(5)));
        let l = log.clone();
        let s2 = s.clone();
        s.set_timeout(
            10,
            Box::new(move || {
                l.borrow_mut().push(10);
                let l = l.clone();
                s2.set_timeout(3, Box::new(move || l.borrow_mut().push(13)));
            }),
        );
        s.clear_timeout(cleared);
        s.advance(15);
        assert_eq!(*log.borrow(), vec![10, 13]);
        s.advance(5);
        assert_eq!(*log.borrow(), vec![10, 13, 20]);
        assert_eq!(s.pending(), 0);
    }
}
