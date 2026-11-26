package com.nazeer.attendance.controller;

import com.nazeer.attendance.model.Account;
import com.nazeer.attendance.service.FileDataStoreService;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final FileDataStoreService store;
    public AuthController(FileDataStoreService store) { this.store = store; }

    public record LoginReq(String username, String password) {}
    public record UpdateAccReq(String password, String companyName) {}

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody LoginReq req) {
        return store.login(req.username(), req.password());
    }

    @PostMapping("/logout")
    public Map<String, String> logout(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        store.logout(token);
        return Map.of("status", "logged_out");
    }

    @GetMapping("/me")
    public Account me(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        return store.requireUser(token);
    }

    @GetMapping("/accounts")
    public List<Account> accounts(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        store.requireAdmin(token);
        return store.getAccounts();
    }

    @PutMapping("/accounts/{id}")
    public Account updateAccount(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                 @PathVariable String id, @RequestBody UpdateAccReq req) throws IOException {
        store.requireAdmin(token);
        return store.updateAccount(id, req.password(), req.companyName());
    }
}
