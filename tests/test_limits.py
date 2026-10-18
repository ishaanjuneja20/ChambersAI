from backend.limits import RateLimiter, check_question, client_ip


def test_rate_limiter_per_visitor_and_overall_and_window():
    t = [1000.0]
    rl = RateLimiter(per_visitor=2, overall=3, clock=lambda: t[0])
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")      # a is over its 2 a minute
    assert rl.allow("b")                                              # b is separate
    assert not rl.allow("c")                                          # 3 in the last minute overall: c is turned away
    t[0] += 61                                                        # a minute later everything is free again
    assert rl.allow("a") and rl.allow("c")
    off = RateLimiter(per_visitor=0, overall=0)
    assert all(off.allow("x") for _ in range(100))                    # 0 = off


def test_client_ip_trusts_headers_only_behind_the_proxy():
    h = {"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 8.8.8.8"}
    assert client_ip(h, "127.0.0.1", True) == "1.2.3.4"
    assert client_ip({"x-forwarded-for": "9.9.9.9, 8.8.8.8"}, "127.0.0.1", True) == "9.9.9.9"
    assert client_ip(h, "127.0.0.1", False) == "127.0.0.1"            # reached directly: headers could be forged
    assert client_ip({}, None, False) == "?"


def test_check_question():
    assert check_question("what is murder?") is None
    assert check_question("   ")[0] == 422 and check_question("")[0] == 422
    assert check_question("x" * 601)[0] == 413 and check_question("x" * 600) is None
    assert check_question("तलाक " * 100, max_chars=1000) is None
