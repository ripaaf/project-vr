package com.questmirror.app;

import android.util.SparseIntArray;
import android.view.KeyEvent;

/** Android key codes (Bluetooth keyboard paired to the Quest) -> Windows virtual-key codes. */
final class KeyMap {
    private static final SparseIntArray MAP = new SparseIntArray();

    static {
        for (int i = 0; i < 26; i++) MAP.put(KeyEvent.KEYCODE_A + i, 0x41 + i);
        for (int i = 0; i < 10; i++) MAP.put(KeyEvent.KEYCODE_0 + i, 0x30 + i);
        for (int i = 0; i < 12; i++) MAP.put(KeyEvent.KEYCODE_F1 + i, 0x70 + i);
        for (int i = 0; i < 10; i++) MAP.put(KeyEvent.KEYCODE_NUMPAD_0 + i, 0x60 + i);
        int[][] pairs = {
                {KeyEvent.KEYCODE_ENTER, 0x0D}, {KeyEvent.KEYCODE_NUMPAD_ENTER, 0x0D},
                {KeyEvent.KEYCODE_DEL, 0x08}, {KeyEvent.KEYCODE_FORWARD_DEL, 0x2E},
                {KeyEvent.KEYCODE_TAB, 0x09}, {KeyEvent.KEYCODE_ESCAPE, 0x1B}, {KeyEvent.KEYCODE_SPACE, 0x20},
                {KeyEvent.KEYCODE_DPAD_LEFT, 0x25}, {KeyEvent.KEYCODE_DPAD_UP, 0x26},
                {KeyEvent.KEYCODE_DPAD_RIGHT, 0x27}, {KeyEvent.KEYCODE_DPAD_DOWN, 0x28},
                {KeyEvent.KEYCODE_SHIFT_LEFT, 0xA0}, {KeyEvent.KEYCODE_SHIFT_RIGHT, 0xA1},
                {KeyEvent.KEYCODE_CTRL_LEFT, 0xA2}, {KeyEvent.KEYCODE_CTRL_RIGHT, 0xA3},
                {KeyEvent.KEYCODE_ALT_LEFT, 0xA4}, {KeyEvent.KEYCODE_ALT_RIGHT, 0xA5},
                {KeyEvent.KEYCODE_META_LEFT, 0x5B}, {KeyEvent.KEYCODE_META_RIGHT, 0x5C},
                {KeyEvent.KEYCODE_MOVE_HOME, 0x24}, {KeyEvent.KEYCODE_MOVE_END, 0x23},
                {KeyEvent.KEYCODE_PAGE_UP, 0x21}, {KeyEvent.KEYCODE_PAGE_DOWN, 0x22},
                {KeyEvent.KEYCODE_INSERT, 0x2D}, {KeyEvent.KEYCODE_CAPS_LOCK, 0x14},
                {KeyEvent.KEYCODE_COMMA, 0xBC}, {KeyEvent.KEYCODE_PERIOD, 0xBE},
                {KeyEvent.KEYCODE_MINUS, 0xBD}, {KeyEvent.KEYCODE_EQUALS, 0xBB},
                {KeyEvent.KEYCODE_LEFT_BRACKET, 0xDB}, {KeyEvent.KEYCODE_RIGHT_BRACKET, 0xDD},
                {KeyEvent.KEYCODE_BACKSLASH, 0xDC}, {KeyEvent.KEYCODE_SEMICOLON, 0xBA},
                {KeyEvent.KEYCODE_APOSTROPHE, 0xDE}, {KeyEvent.KEYCODE_SLASH, 0xBF},
                {KeyEvent.KEYCODE_GRAVE, 0xC0}, {KeyEvent.KEYCODE_SYSRQ, 0x2C},
                {KeyEvent.KEYCODE_NUMPAD_ADD, 0x6B}, {KeyEvent.KEYCODE_NUMPAD_SUBTRACT, 0x6D},
                {KeyEvent.KEYCODE_NUMPAD_MULTIPLY, 0x6A}, {KeyEvent.KEYCODE_NUMPAD_DIVIDE, 0x6F},
                {KeyEvent.KEYCODE_NUMPAD_DOT, 0x6E},
        };
        for (int[] p : pairs) MAP.put(p[0], p[1]);
    }

    private KeyMap() {
    }

    /** Windows VK code, or 0 when the key should stay on the headset. */
    static int toVk(int keyCode) {
        return MAP.get(keyCode, 0);
    }
}
