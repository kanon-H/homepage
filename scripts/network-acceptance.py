"""Optional P5 integration checks; never reads the user's Homepage configuration.

Requires an existing production build (or --build), Python Playwright, Chromium,
nginx and openssl. No package installation, system service, deployment or git action.
Run from any directory; all fixtures/evidence are under ignored config/p5-baseline.
See DEVELOPMENT.md for setup, scope and the remaining manual acceptance checks.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = "homepage.network.preference.v1"
DEFAULT = "https://default.example.invalid/Case?x=1#Part"
# A real loopback destination also receives native background-tab requests that
# Chromium can start before Playwright attaches routing to the new target.
LAN = "http://127.0.0.1:3310/Case?x=2#Part"
VPN = "https://vpn.example.invalid/Case"
BOOKMARK = "https://bookmark.example.invalid/Case"
BASE = "https://localhost:3443"
# Reserved .test name mapped to loopback only inside the test browser. Unlike
# localhost/127.0.0.1, this HTTP origin is not a potentially trustworthy origin.
INSECURE_BASE = "http://p5-fixture.test:3308"
APP = "http://127.0.0.1:3307"
BACKEND = "http://127.0.0.1:3310"


def fixtures(phase):
    settings = {
        "title": "P5 Fictional Dashboard", "language": "zh-Hans" if phase == "chinese" else "en",
        "theme": "dark", "color": "slate", "hideVersion": True,
        "disableUpdateCheck": True, "target": "_blank",
        "quicklaunch": {"mobileButtonPosition": "bottom-right", "provider": "custom",
                        "url": "https://search.example.invalid/?q=", "showSearchSuggestions": False},
    }
    if phase != "legacy":
        settings["extensions"] = {"network": {
            "enabled": phase != "disabled", "defaultMode": "lan",
            "modes": [{"id": "lan", "label": "LAN"}, {"id": "vpn", "label": "VPN"},
                      {"id": "office", "label": "Office"},
                      {"id": "long", "label": "Long mode label " + "W" * 48}],
        }}
    service = {
        "id": "p5-network", "href": DEFAULT, "icon": "/icons/p5.svg",
        "description": "Fictional network service", "siteMonitor": BACKEND + "/monitor",
        "widget": {"type": "customapi", "url": BACKEND + "/widget",
                   "headers": {"Authorization": "Bearer fictional-widget-secret"},
                   "mappings": [{"field": "value", "label": "Fixture value"}], "refreshInterval": 1000},
    }
    if phase != "legacy":
        service["extensions"] = {"network": {"addresses": {
            "lan": LAN, "vpn": VPN, "long": LAN,
            "office": "http://fixture-user:fixture-password@rejected.example.invalid",
            "unknown": "javascript:fixture-rejected",
        }}}
    services = [{"Root": [
        {"P5-Legacy": {"id": "p5-legacy", "href": "/api/healthcheck", "target": "_self"}},
        {"P5-Relative": {"id": "p5-relative", "href": "../relative"}},
        {"P5-Protocol": {"id": "p5-protocol", "href": "mailto:fixture@example.invalid"}},
        {"P5-NoLink": {"id": "p5-nolink", "href": "#", "extensions": {"network": {"addresses": {"lan": LAN}}}}},
        {"Nested": [{"P5-Network": service}, {"P5-Other": {
            "id": "p5-other", "href": "https://other.example.invalid/", "target": "_blank",
            "extensions": {"network": {"addresses": {"lan": LAN}}},
        }}]},
    ]}]
    bookmarks = [{"Links": [{"P5-Bookmark": [{"href": BOOKMARK, "abbr": "P5",
        "extensions": {"network": {"addresses": {"lan": LAN}}}}]}]}]
    result = {"settings.yaml": settings, "services.yaml": services, "bookmarks.yaml": bookmarks,
              "widgets.yaml": [], "docker.yaml": {}, "kubernetes.yaml": {}, "proxmox.yaml": {}}
    if phase == "legacy":
        def without_extensions(value):
            if isinstance(value, dict):
                return {key: without_extensions(child) for key, child in value.items() if key != "extensions"}
            if isinstance(value, list):
                return [without_extensions(child) for child in value]
            return value
        result = {name: without_extensions(value) for name, value in result.items()}
    return result


class Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.hrefs.append(dict(attrs).get("href"))


class FixtureBackend(BaseHTTPRequestHandler):
    calls = []
    lock = threading.Lock()

    def do_GET(self):
        with self.lock:
            self.calls.append(self.path)
            count = len(self.calls)
        body = json.dumps({"value": 42, "count": count}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "public, max-age=60" if self.path == "/cache-control" else "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # No headers, Cookie, Authorization or credentials in evidence.


class Runner:
    def __init__(self, args):
        self.args = args
        self.output = ROOT / "config/p5-baseline" / (datetime.now(timezone.utc).strftime("run-%Y%m%dT%H%M%SZ-") + secrets.token_hex(3))
        self.output.mkdir(parents=True)
        self.results = []
        self.errors = []
        self.browser_version = None
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("HOMEPAGE_", "NEXTAUTH_"))}
        self.env.update({"NEXT_TELEMETRY_DISABLED": "1", "LOG_TARGETS": "stdout",
                         "HOMEPAGE_AUTH_ENABLED": "true", "HOMEPAGE_AUTH_SECRET": secrets.token_urlsafe(48),
                         "HOMEPAGE_AUTH_PASSWORD": secrets.token_urlsafe(32), "HOMEPAGE_EXTERNAL_URL": BASE,
                         "HOMEPAGE_ALLOWED_HOSTS": "localhost:3443", "PORT": "3307", "HOSTNAME": "127.0.0.1"})

    def check(self, condition, label):
        self.results.append({"check": label, "passed": bool(condition)})
        if not condition:
            raise AssertionError(label)
        print("PASS " + label, flush=True)

    @contextmanager
    def process(self, command, log, env=None):
        with (self.output / log).open("w") as output:
            proc = subprocess.Popen(command, cwd=ROOT, env=env or self.env, stdout=output,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            try:
                yield proc
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGTERM)
                    try:
                        proc.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait(timeout=5)

    def configure(self, phase):
        config = self.output / phase
        config.mkdir()
        for name, value in fixtures(phase).items():
            (config / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        for name in ("custom.css", "custom.js"):
            (config / name).write_text("")
        self.env["HOMEPAGE_CONFIG_DIR"] = str(config)

    def proxy_config(self, tls):
        conf = self.output / "nginx.conf"
        # An intentionally cache-capable proxy: upstream Cache-Control/Set-Cookie
        # decide storage. Do not add Cookie bypasses that would mask origin bugs.
        http_server = f'''  server {{
    listen 127.0.0.1:3308;
    server_name p5-fixture.test;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto http;
    proxy_set_header X-Forwarded-Host $http_host;
    location / {{ proxy_pass {APP}; }}
  }}
''' if self.args.insecure_http else ""
        conf.write_text(f'''worker_processes 1;
pid {self.output}/nginx.pid;
error_log {self.output}/nginx-error.log warn;
events {{ worker_connections 256; }}
http {{
  access_log off;
  client_body_temp_path {self.output}/client-temp;
  proxy_temp_path {self.output}/proxy-temp;
  fastcgi_temp_path {self.output}/fastcgi-temp;
  uwsgi_temp_path {self.output}/uwsgi-temp;
  scgi_temp_path {self.output}/scgi-temp;
  proxy_cache_path {self.output}/cache levels=1:2 keys_zone=p5:8m inactive=1m max_size=32m;
  server {{
    listen 127.0.0.1:3443 ssl;
    server_name localhost;
    ssl_certificate {tls}/cert.pem;
    ssl_certificate_key {tls}/key.pem;
    add_header X-P5-Cache $upstream_cache_status always;
    proxy_cache p5;
    proxy_cache_key "$scheme$host$request_uri";
    proxy_cache_valid 200 302 307 60s;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $http_host;
    location = /__cache_probe {{ proxy_pass {BACKEND}/cache-control; }}
    location / {{ proxy_pass {APP}; }}
  }}
{http_server}}}
''')
        with (self.output / "nginx-check.log").open("w") as output:
            subprocess.run([self.args.nginx, "-e", "stderr", "-p", str(self.output), "-c", str(conf), "-t"],
                           env=self.env, check=True, stdout=output, stderr=subprocess.STDOUT)
        return conf

    def route(self, route):
        url = route.request.url
        if urlsplit(url).netloc == urlsplit(BASE).netloc:
            if urlsplit(url).path == "/icons/p5.svg":
                route.fulfill(content_type="image/svg+xml", body='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>')
            else:
                route.continue_()
        elif urlsplit(url).netloc == urlsplit(BACKEND).netloc:
            route.continue_()
        elif urlsplit(url).hostname and urlsplit(url).hostname.endswith(".invalid"):
            route.fulfill(content_type="text/html", body="<title>Fictional destination</title><p>Navigation fixture</p>")
        else:
            route.abort()  # No real external navigations or search requests.

    def context(self, browser, **options):
        ctx = browser.new_context(ignore_https_errors=True, **options)
        ctx.route("**/*", self.route)
        ctx.on("page", lambda page: page.on("pageerror", lambda error: self.errors.append(str(error))))
        return ctx

    def login(self, ctx):
        csrf = ctx.request.get(BASE + "/api/auth/csrf").json()["csrfToken"]
        response = ctx.request.post(BASE + "/api/auth/callback/credentials", form={
            "csrfToken": csrf, "password": self.env["HOMEPAGE_AUTH_PASSWORD"], "callbackUrl": BASE, "json": "true",
        })
        self.check(response.status == 200 and bool(ctx.request.get(BASE + "/api/auth/session").json().get("expires")), "native password session established")

    def protected(self, ctx, paths, prefix):
        for path in paths:
            response = ctx.request.get(BASE + path, max_redirects=0)
            body = response.text()
            self.check(response.status in (302, 307, 401) and not any(value in body for value in (
                "P5-Network", "P5-Bookmark", "example.invalid", "fixture-password", "fictional-widget-secret")),
                f"{prefix}: no anonymous inventory: {path}")
            self.check("no-store" in response.headers.get("cache-control", ""), f"{prefix}: private cache boundary: {path}")

    def signout(self, ctx):
        csrf = ctx.request.get(BASE + "/api/auth/csrf").json()["csrfToken"]
        ctx.request.post(BASE + "/api/auth/signout", form={"csrfToken": csrf, "callbackUrl": BASE, "json": "true"})

    def open_destination(self, page, action, expected_url, label):
        # Middle/Ctrl-click create background tabs, not necessarily a page popup event.
        with page.context.expect_page() as popup:
            action()
        target = popup.value
        try:
            target.wait_for_url(expected_url)
        except Exception:
            print(f"Fictional destination mismatch: {label}: {target.url!r}", flush=True)
            raise
        self.check(target.url == expected_url, label)
        target.close()

    def navigation(self, page, expected_href):
        anchors = page.locator("#p5-network a.service-icon, #p5-network a.service-title-text")
        expect(anchors).to_have_count(2)
        for anchor in anchors.all():
            expect(anchor).to_have_attribute("href", expected_href)
            expect(anchor).to_have_attribute("target", "_blank")
            expect(anchor).to_have_attribute("rel", "noreferrer")

    def search(self, page, query):
        field = page.get_by_placeholder("Search", exact=True)
        # Upstream closes with a 200ms delayed query reset and a 300ms transition.
        # Wait for both, rather than letting the previous close erase the next query.
        expect(field).not_to_be_visible()
        expect(field).to_have_value("")
        page.keyboard.press("p")
        expect(field).to_be_visible()
        field.fill(query)
        return field

    def browser_checks(self, browser, ctx, page):
        switch = page.get_by_role("combobox", name="Network mode")
        expect(switch).to_be_enabled()
        expect(switch).to_have_value("lan")
        self.navigation(page, LAN)
        self.check(page.evaluate("localStorage.getItem('" + KEY + "')") is None, "initialization never writes preference")
        title = page.locator("#p5-network a.service-title-text")
        icon = page.locator("#p5-network a.service-icon")
        trigger = page.locator("#p5-network .service-address-menu-trigger")
        menu = page.get_by_role("menu")
        self.open_destination(page, lambda: title.click(), LAN, "native title left-click uses LAN")
        self.open_destination(page, lambda: icon.click(button="middle"), LAN, "native icon middle-click opens LAN tab")
        self.open_destination(page, lambda: title.click(modifiers=["Control"]), LAN, "native Ctrl-click opens LAN tab (Linux)")
        title.click(button="right")
        expect(menu).to_be_visible()
        self.check(menu.locator("a").count() == 4, "menu retains duplicate URL modes and excludes invalid/missing address")
        expect(menu.locator('a[aria-current="true"]')).to_have_attribute("href", LAN)
        self.open_destination(page, lambda: menu.locator("a").nth(1).click(button="middle"), LAN, "native menu middle-click opens LAN tab")
        expect(menu).to_be_visible()
        self.open_destination(page, lambda: menu.locator("a").nth(1).click(modifiers=["Control"]), LAN, "native menu Ctrl-click opens LAN tab")
        expect(menu).to_have_count(0)
        title.click(button="right")
        expect(menu).to_be_visible()
        self.open_destination(page, lambda: menu.get_by_role("menuitem", name="Open default address", exact=True).click(), DEFAULT, "temporary menu default opens original href")
        expect(menu).to_have_count(0)
        expect(switch).to_have_value("lan")
        self.check(page.evaluate("localStorage.getItem('" + KEY + "')") is None, "temporary opening never writes mode")

        # Trusted browser input, not jsdom: observe whether native events were cancelled.
        page.evaluate("""() => { window.p5ContextEvents = []; document.addEventListener('contextmenu', e => {
          window.p5ContextEvents.push({prevented: e.defaultPrevented, shift: e.shiftKey});
        }); }""")
        title.click(button="right", modifiers=["Shift"])
        expect(menu).to_have_count(0)
        self.check(page.evaluate("p5ContextEvents.at(-1)?.prevented === false && p5ContextEvents.at(-1)?.shift === true"), "Shift+right-click passes trusted contextmenu through (native UI requires manual check)")
        page.keyboard.press("Escape")
        widget = page.locator("#p5-network .service-card").get_by_text("Fixture value", exact=True)
        expect(widget).to_be_visible()
        widget.click(button="right")
        self.check(page.evaluate("p5ContextEvents.at(-1)?.prevented === false"), "Widget right-click is not intercepted")
        page.keyboard.press("Escape")
        monitor = page.locator("#p5-network .service-site-monitor")
        monitor.click(button="right")
        self.check(page.evaluate("p5ContextEvents.at(-1)?.prevented === false"), "monitor right-click is not intercepted")
        page.keyboard.press("Escape")

        trigger.focus()
        trigger.press("ArrowDown")
        expect(menu.get_by_role("menuitem").first).to_be_focused()
        page.keyboard.press("End")
        expect(menu.get_by_role("menuitem").last).to_be_focused()
        page.keyboard.press("Home")
        expect(menu.get_by_role("menuitem").first).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(menu.get_by_role("menuitem").last).to_be_focused()
        page.keyboard.press("Escape")
        expect(trigger).to_be_focused()
        self.check(True, "real keyboard cycling, Home/End/Escape and trigger focus")
        trigger.press("Enter")
        page.keyboard.press("Tab")
        expect(menu).to_have_count(0)
        self.check(not page.locator('div[role="dialog"]').is_visible(), "menu Tab does not open global search")
        trigger.click()
        page.locator("#p5-other a.service-title-text").click(button="right", position={"x": 5, "y": 10})
        expect(menu).to_have_count(1)
        expect(menu).to_have_attribute("aria-label", "Addresses for P5-Other")
        page.keyboard.press("Escape")
        trigger.click()
        page.mouse.click(2, 2)
        expect(menu).to_have_count(0)
        page.set_viewport_size({"width": 1440, "height": 300})
        trigger.scroll_into_view_if_needed()
        trigger.click()
        page.mouse.move(2, 2)
        page.mouse.wheel(0, 300)
        expect(menu).to_have_count(0)
        page.set_viewport_size({"width": 1440, "height": 900})
        self.check(True, "single menu, external click and native wheel page scroll close")
        trigger.click()
        page.set_viewport_size({"width": 1200, "height": 700})
        expect(menu).to_have_count(0)
        page.set_viewport_size({"width": 1440, "height": 900})

        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
        trigger.click()
        menu.get_by_role("menuitem", name="Copy current address", exact=True).click()
        expect(menu.get_by_role("status")).to_have_text("Address copied")
        self.check(page.evaluate("navigator.clipboard.readText()") == LAN, "real secure Clipboard API writes current address")
        page.keyboard.press("Escape")
        denied = self.context(browser)
        try:
            # Actual browser permission denial via CDP; not a mocked writeText rejection.
            denied.add_cookies(ctx.cookies())
            dp = denied.new_page()
            dp.goto(BASE)
            session = denied.new_cdp_session(dp)
            context_id = session.send("Target.getTargetInfo")["targetInfo"]["browserContextId"]
            for unsanitized in (False, True):
                session.send("Browser.setPermission", {"browserContextId": context_id,
                    "permission": {"name": "clipboard-write", "allowWithoutSanitization": unsanitized},
                    "setting": "denied", "origin": BASE})
            self.check(dp.evaluate("navigator.permissions.query({name: 'clipboard-write'}).then(p => p.state)") == "denied", "clipboard denial applies to tested browser context")
            dp.locator("#p5-network .service-address-menu-trigger").click()
            dp.get_by_role("menuitem", name="Copy current address", exact=True).click()
            expect(dp.get_by_role("menu").get_by_role("alert")).to_have_text("Unable to copy. Use HTTPS and allow clipboard access.")
            self.check(True, "real browser clipboard permission denial reports failure")
            session.detach()
        finally:
            denied.close()
        missing = self.context(browser)
        try:
            missing.add_cookies(ctx.cookies())
            missing.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
            mp = missing.new_page()
            mp.goto(BASE)
            mp.locator("#p5-network .service-address-menu-trigger").click()
            mp.get_by_role("menuitem", name="Copy current address", exact=True).click()
            expect(mp.get_by_role("menu").get_by_role("alert")).to_have_text("Unable to copy. Use HTTPS and allow clipboard access.")
            self.check(True, "injected missing Clipboard API reports failure in real browser")
        finally:
            missing.close()

        switch.select_option("office")
        self.navigation(page, DEFAULT)
        trigger.click()
        expect(menu.get_by_role("note")).to_have_text("Currently using the default address")
        expect(menu.locator('a[aria-current="true"]')).to_have_attribute("href", DEFAULT)
        page.keyboard.press("Escape")
        switch.select_option("vpn")
        self.navigation(page, VPN)
        stored = page.evaluate("localStorage.getItem('" + KEY + "')")
        try:
            preference = json.loads(stored or "null")
        except (ValueError, TypeError):
            preference = None
        self.check(preference == {"version": 1, "mode": "vpn"}, "preference stores only version and mode")
        page.reload()
        expect(switch).to_have_value("vpn")
        self.navigation(page, VPN)
        self.check(True, "real reload restores saved VPN")
        other = ctx.new_page()
        other.goto(BASE)
        expect(other.get_by_role("combobox")).to_have_value("vpn")
        other.get_by_role("combobox").select_option("lan")
        expect(switch).to_have_value("lan")
        other.evaluate("localStorage.setItem('unrelated', 'value')")
        expect(switch).to_have_value("lan")
        other.evaluate("localStorage.removeItem('" + KEY + "')")
        expect(switch).to_have_value("lan")
        other.get_by_role("combobox").select_option("vpn")
        other.evaluate("localStorage.clear()")
        expect(switch).to_have_value("lan")
        self.check(True, "real same-origin storage synchronization, unrelated key, removal and clear")

        # Keep search open while a *different real tab* changes the mode.
        field = self.search(page, "P5-Network")
        other.get_by_role("combobox").select_option("vpn")
        self.open_destination(page, lambda: field.press("Enter"), VPN, "open search result uses new mode from another tab")
        field = self.search(page, "P5-Bookmark")
        self.open_destination(page, lambda: field.press("Enter"), BOOKMARK, "bookmark search never uses network addresses")
        field = self.search(page, "https://typed.example.invalid/Case")
        self.open_destination(page, lambda: field.press("Enter"), "https://typed.example.invalid/Case", "typed URL search retains original path casing")
        field = self.search(page, "fixture query")
        self.open_destination(page, lambda: field.press("Enter"), "https://search.example.invalid/?q=fixture%20query", "search provider navigation is unchanged")
        other.close()
        self.check(page.locator("#p5-relative a").first.get_attribute("href") == "../relative" and page.locator("#p5-protocol a").first.get_attribute("href").startswith("mailto:"), "legacy relative and special protocols are not tightened")
        self.check(page.locator("#p5-nolink a, #p5-nolink .service-address-menu-trigger").count() == 0, "hash-only service does not become expandable")
        page.screenshot(path=str(self.output / "desktop.png"))
        self.storage_checks(browser, ctx)
        self.mobile_checks(browser, ctx)

    def storage_checks(self, browser, authenticated):
        for case, raw in (("broken", "{"), ("version", '{"version":2,"mode":"vpn"}'),
                          ("deleted", '{"version":1,"mode":"deleted"}'), ("saved", '{"version":1,"mode":"vpn"}'),
                          ("throws", None)):
            ctx = self.context(browser)
            try:
                ctx.add_cookies(authenticated.cookies())
                if raw is not None:
                    ctx.add_init_script("if (location.origin === " + json.dumps(BASE) + ") { localStorage.setItem(" + json.dumps(KEY) + ", " + json.dumps(raw) + "); }")
                else:
                    ctx.add_init_script("""(() => { for (const method of ['getItem', 'setItem']) {
                      const original = Storage.prototype[method]; Storage.prototype[method] = function(key, ...args) {
                        if (key === 'homepage.network.preference.v1') throw new DOMException('Fixture blocked', 'SecurityError');
                        return original.call(this, key, ...args);
                      }; } })();""")
                page = ctx.new_page()
                page.goto(BASE)
                switch = page.get_by_role("combobox")
                expect(switch).to_be_enabled()
                expect(switch).to_have_value("vpn" if case == "saved" else "lan")
                self.navigation(page, VPN if case == "saved" else LAN)
                if case == "throws":
                    switch.select_option("vpn")
                    self.navigation(page, VPN)
                self.check(True, f"isolated browser preference {case}: recovery and navigation safe")
            finally:
                ctx.close()

    def mobile_checks(self, browser, authenticated):
        ctx = self.context(browser, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
        try:
            ctx.add_cookies(authenticated.cookies())
            page = ctx.new_page()
            page.goto(BASE)
            switch = page.get_by_role("combobox")
            expect(switch).to_be_visible()
            self.check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "390px mobile viewport has no horizontal overflow")
            trigger = page.locator("#p5-network .service-address-menu-trigger")
            trigger.tap()
            menu = page.get_by_role("menu")
            expect(menu).to_be_visible()
            self.check(menu.evaluate("el => {const r=el.getBoundingClientRect(); return r.left>=7 && r.right<=innerWidth-7 && r.top>=7 && r.bottom<=innerHeight-7}"), "touch-emulated more button opens unclipped viewport-contained menu")
            page.screenshot(path=str(self.output / "mobile.png"))
            page.keyboard.press("Escape")
            switch.select_option("long")
            self.navigation(page, LAN)
            self.check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "64-codepoint label does not overflow mobile header")
            page.set_viewport_size({"width": 320, "height": 240})
            trigger.scroll_into_view_if_needed()
            trigger.tap()
            expect(menu).to_be_visible()
            self.check(menu.evaluate("el => {const r=el.getBoundingClientRect(); return r.left>=7 && r.right<=innerWidth-7 && r.top>=7 && r.bottom<=innerHeight-7}"), "320x240 edge menu remains inside viewport despite card overflow-clip")
            menu.evaluate("el => el.scrollTop = el.scrollHeight")
            expect(menu).to_be_visible()
            self.check(True, "internal long-menu scroll keeps menu open")
            page.screenshot(path=str(self.output / "short-viewport.png"))
        finally:
            ctx.close()

    def phase(self, browser, phase, paths):
        self.configure(phase)
        with self.process(["node", str(ROOT / ".next/standalone/server.js")], f"server-{phase}.log") as server:
            anon = self.context(browser)
            ctx = self.context(browser, viewport={"width": 1440, "height": 900})
            if phase in ("disabled", "legacy"):
                ctx.add_init_script("""if (location.origin === 'https://localhost:3443') {
                  localStorage.setItem('homepage.network.preference.v1', '{"version":1,"mode":"vpn"}');
                  window.p5NetworkStorageCalls = [];
                  for (const method of ['getItem', 'setItem', 'removeItem']) {
                    const original = Storage.prototype[method];
                    Storage.prototype[method] = function(key, ...args) {
                      if (key === 'homepage.network.preference.v1') window.p5NetworkStorageCalls.push(method);
                      return original.call(this, key, ...args);
                    };
                  }
                }""")
            try:
                for _ in range(90):
                    if server.poll() is not None:
                        raise RuntimeError(f"temporary standalone exited: {phase}")
                    try:
                        if anon.request.get(BASE + "/api/healthcheck", timeout=1500).status == 200:
                            break
                    except Exception:
                        pass
                    time.sleep(0.5)
                else:
                    raise TimeoutError("standalone did not become ready")
                self.protected(anon, paths, phase)
                if phase == "enabled":
                    first = anon.request.get(BASE + "/__cache_probe")
                    second = anon.request.get(BASE + "/__cache_probe")
                    self.check(first.headers.get("x-p5-cache") == "MISS" and second.headers.get("x-p5-cache") == "HIT" and first.text() == second.text(), "real nginx shared cache positive control: MISS then anonymous HIT")
                    page = ctx.new_page()
                    page.goto(BASE)
                    page.locator('input[name="password"]').fill("wrong-fixture-password")
                    page.get_by_role("button", name="Sign in").click()
                    expect(page.get_by_text("Invalid password. Please try again.")).to_be_visible()
                    page.locator('input[name="password"]').fill(self.env["HOMEPAGE_AUTH_PASSWORD"])
                    page.get_by_role("button", name="Sign in").click()
                    expect(page.locator("#p5-network")).to_be_visible()
                    self.check(True, "real browser native password login rejects wrong password and accepts correct one")
                else:
                    self.login(ctx)
                    page = ctx.new_page()
                    page.goto(BASE)
                api = ctx.request.get(BASE + "/api/services").json()
                serialized = json.dumps(api)
                self.check("fictional-widget-secret" not in serialized and "fixture-password" not in serialized, phase + ": Widget credentials and rejected URLs absent from API")
                self.check(ctx.request.get(BASE + paths[-1]).json()["pageProps"]["fallback"]["/api/services"] == api, phase + ": SSR/Next data and API raw snapshots match")
                html = ctx.request.get(BASE + "/").text()
                self.check(not any(value in html for value in ("fictional-widget-secret", "fixture-password")), phase + ": rejected credentials and Widget secrets absent from HTML")
                anchors = Anchors()
                anchors.feed(html)
                if phase in ("enabled", "chinese"):
                    self.check(DEFAULT not in anchors.hrefs and LAN not in anchors.hrefs, phase + ": production SSR suppresses expandable href before recovery")
                else:
                    expect(page.get_by_role("combobox")).to_have_count(0)
                    expect(page.locator(".service-address-menu-trigger")).to_have_count(0)
                    self.navigation(page, DEFAULT)
                    expect(page.locator("#p5-network").get_by_text("42", exact=True)).to_be_visible()
                    self.check(page.evaluate("p5NetworkStorageCalls.length === 0"), phase + ": hydrated old preference is neither read nor written")
                    self.check(page.evaluate("localStorage.getItem('" + KEY + "')") == '{"version":1,"mode":"vpn"}', phase + ": disabled extension preserves old preference")
                    self.check(True, phase + ": original links and no network UI")
                for path in paths:
                    for _ in range(2):
                        response = ctx.request.get(BASE + path)
                        self.check(response.status == 200 and "no-store" in response.headers.get("cache-control", "") and response.headers.get("x-p5-cache") != "HIT", phase + ": authenticated response never shared-cached: " + path)
                self.protected(anon, paths, phase + " after authenticated cache warming")
                self.check(ctx.request.get(BASE + "/api/validate").json() == [], phase + ": nonfatal configuration warnings do not block page")
                if phase == "enabled":
                    self.browser_checks(browser, ctx, page)
                    self.check(ctx.request.get(BASE + "/api/services").json() == api, "browser modes never mutate server raw service snapshot")
                    with FixtureBackend.lock:
                        calls = list(FixtureBackend.calls)
                    self.check("/widget" in calls and "/monitor" in calls and all(path in ("/widget", "/monitor", "/cache-control", "/Case?x=2", "/favicon.ico") for path in calls), "real Widget/monitor backend requests stay on configured targets")
                    self.check(ctx.request.get(BASE + "/api/services", headers={"Host": "untrusted.example.invalid"}, max_redirects=0).status == 400, "Host validation remains enforced through reverse proxy")
                elif phase == "chinese":
                    expect(page.get_by_role("combobox", name="网络模式")).to_be_enabled()
                    page.locator("#p5-network .service-address-menu-trigger").click()
                    expect(page.get_by_role("menuitem", name="打开默认地址", exact=True)).to_be_visible()
                    self.check(True, "real zh-Hans menu/switcher resources")
                    page.screenshot(path=str(self.output / "chinese.png"))
                page.keyboard.press("Escape")
                page.locator("#p5-legacy a.service-title-text").click()
                expect(page).to_have_url(BASE + "/api/healthcheck")
                self.check(True, phase + ": explicit service _self overrides global _blank")
                self.signout(ctx)
                self.protected(ctx, paths, phase + " after sign-out")
            finally:
                ctx.close()
                anon.close()
        print("Temporary standalone stopped: " + phase, flush=True)

    def insecure_http_checks(self, playwright):
        self.configure("insecure-http")
        env = {**self.env, "HOMEPAGE_EXTERNAL_URL": INSECURE_BASE,
               "HOMEPAGE_ALLOWED_HOSTS": "p5-fixture.test:3308"}
        with self.process(["node", str(ROOT / ".next/standalone/server.js")], "server-insecure-http.log", env=env) as server:
            browser = playwright.chromium.launch(executable_path=self.args.chromium, headless=True,
                args=["--host-resolver-rules=MAP p5-fixture.test 127.0.0.1", "--no-proxy-server"])
            try:
                ctx = browser.new_context(viewport={"width": 1280, "height": 800})
                ctx.on("page", lambda page: page.on("pageerror", lambda error: self.errors.append(str(error))))

                def local_only(route):
                    url = urlsplit(route.request.url)
                    if url.netloc in (urlsplit(INSECURE_BASE).netloc, urlsplit(BACKEND).netloc):
                        route.continue_()
                    else:
                        route.abort()

                ctx.route("**/*", local_only)
                page = ctx.new_page()
                for _ in range(90):
                    if server.poll() is not None:
                        raise RuntimeError("temporary HTTP standalone exited")
                    try:
                        # IP literal is used only for readiness; the browser tests
                        # below navigate to .test and assert the real security state.
                        response = ctx.request.get("http://127.0.0.1:3308/api/healthcheck",
                            headers={"Host": "p5-fixture.test:3308"}, timeout=1500)
                        if response.status == 200:
                            break
                    except Exception:
                        pass
                    time.sleep(0.5)
                else:
                    raise TimeoutError("temporary HTTP standalone did not become ready")
                page.goto(INSECURE_BASE)
                expect(page.locator('input[name="password"]')).to_be_visible()
                self.check(not page.locator("#p5-network").count(), "HTTP fixture remains protected before native login")
                self.check(page.evaluate("isSecureContext === false"), "ordinary HTTP .test origin is a real non-secure browser context")
                self.check(page.evaluate("typeof navigator.clipboard === 'undefined'"), "Clipboard API is genuinely unavailable on ordinary HTTP, not injected")
                page.locator('input[name="password"]').fill(self.env["HOMEPAGE_AUTH_PASSWORD"])
                page.get_by_role("button", name="Sign in").click()
                switch = page.get_by_role("combobox", name="Network mode")
                expect(switch).to_be_enabled()
                self.navigation(page, LAN)
                self.check(page.evaluate("location.origin") == INSECURE_BASE and page.evaluate("isSecureContext === false"), "native password login preserves the non-secure test origin")
                page.locator("#p5-network .service-address-menu-trigger").click()
                menu = page.get_by_role("menu")
                menu.get_by_role("menuitem", name="Copy current address", exact=True).click()
                expect(menu.get_by_role("alert")).to_have_text("Unable to copy. Use HTTPS and allow clipboard access.")
                expect(menu.get_by_role("status")).to_have_count(0)
                self.check(True, "ordinary HTTP copy reports failure, with no false success or redirect")
                self.check(page.url == INSECURE_BASE + "/", "HTTP clipboard failure leaves the dashboard URL unchanged")
                page.screenshot(path=str(self.output / "insecure-http.png"))
                page.keyboard.press("Escape")
                switch.select_option("vpn")
                self.navigation(page, VPN)
                self.check(True, "HTTP clipboard failure does not break later network-mode navigation")
                self.check(ctx.request.get("http://127.0.0.1:3308/api/services",
                    headers={"Host": "untrusted.example.invalid"}, max_redirects=0).status == 400,
                    "HTTP fixture retains Host validation")
            finally:
                browser.close()
        print("Temporary ordinary HTTP standalone stopped", flush=True)

    def run(self):
        ports = (3307, 3443, 3310, 3308) if self.args.insecure_http else (3307, 3443, 3310)
        for port in ports:
            with socket.socket() as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", port))  # Refuse active listeners; allow our previous TIME_WAIT.
        self.configure("build")
        if self.args.build:
            with (self.output / "build.log").open("w") as output:
                subprocess.run(["corepack", "pnpm@10.34.9", "build"], cwd=ROOT, env=self.env,
                               stdout=output, stderr=subprocess.STDOUT, check=True, timeout=600)
            self.check(True, "production build from fictional isolated configuration")
        standalone = ROOT / ".next/standalone"
        if not (standalone / "server.js").is_file():
            raise RuntimeError("No standalone build; rerun with --build")
        shutil.copytree(ROOT / "public", standalone / "public", dirs_exist_ok=True)
        shutil.copytree(ROOT / ".next/static", standalone / ".next/static", dirs_exist_ok=True)
        build_id = (ROOT / ".next/BUILD_ID").read_text().strip()
        paths = ["/", "/api/services", "/api/bookmarks", "/api/widgets", f"/_next/data/{build_id}/en.json"]
        backend = ThreadingHTTPServer(("127.0.0.1", 3310), FixtureBackend)
        threading.Thread(target=backend.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory(prefix="tls-", dir=self.output) as tls:
                # Test-only key is deleted even on failure; no auth credentials or cookies written.
                subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
                    "-keyout", tls + "/key.pem", "-out", tls + "/cert.pem"], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                conf = self.proxy_config(tls)
                with self.process([self.args.nginx, "-e", "stderr", "-p", str(self.output), "-c", str(conf), "-g", "daemon off;"], "nginx.log"):
                    with sync_playwright() as playwright:
                        browser = playwright.chromium.launch(executable_path=self.args.chromium, headless=True)
                        try:
                            self.browser_version = browser.version
                            for phase in self.args.phases:
                                self.phase(browser, phase, paths)
                            if self.args.insecure_http:
                                self.insecure_http_checks(playwright)
                            self.check(not self.errors, "no browser pageerror across exercised contexts")
                        finally:
                            browser.close()
        finally:
            backend.shutdown()
            backend.server_close()

    def report(self, outcome):
        sources = [Path(__file__).resolve(), ROOT / "src/components/services/item.jsx", ROOT / "src/components/quicklaunch.jsx",
                   ROOT / "src/pages/index.jsx", ROOT / "src/proxy.js", ROOT / "src/utils/contexts/network.jsx",
                   ROOT / "src/utils/contexts/service-menu.jsx", *sorted((ROOT / "src/utils/network").glob("*.js")),
                   *sorted((ROOT / "src/components/network").glob("*.jsx"))]
        report = {"outcome": outcome, "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                  "dirty_worktree": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)),
                  "browser": self.browser_version, "headless": True, "build_executed": self.args.build,
                  "python": sys.version.split()[0], "playwright": version("playwright"),
                  "nginx": subprocess.check_output([self.args.nginx, "-v"], env=self.env, stderr=subprocess.STDOUT, text=True).strip(),
                  "source_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},
                  "phases": self.args.phases, "insecure_http_executed": self.args.insecure_http,
                  "checks": self.results, "page_errors": self.errors,
                  "fixture_backend_paths": sorted(set(FixtureBackend.calls)),
                  "not_proven": ["OS native context-menu UI", "physical touch device", "macOS Cmd-click",
                                 "production proxy/CDN", "real OIDC identity provider", "full hand-operated browser acceptance"]}
        (self.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print("Evidence: " + str(self.output.relative_to(ROOT)), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium", required=True, help="Existing Chromium executable; never downloads a browser")
    parser.add_argument("--nginx", required=True, help="Existing standalone nginx executable; never changes nginx-ui/system services")
    parser.add_argument("--build", action="store_true", help="Build current source with fictional config before checks")
    parser.add_argument("--insecure-http", action="store_true", help="Also test real non-secure HTTP on a browser-only loopback .test hostname (port 3308)")
    parser.add_argument("--phases", nargs="+", choices=["enabled", "disabled", "legacy", "chinese"], default=["enabled", "disabled", "legacy", "chinese"])
    args = parser.parse_args()
    args.chromium = str(Path(args.chromium).resolve(strict=True))
    args.nginx = str(Path(args.nginx).resolve(strict=True))
    runner = Runner(args)
    try:
        runner.run()
    except BaseException:
        runner.report("failed")
        raise
    runner.report("passed")


if __name__ == "__main__":
    main()
