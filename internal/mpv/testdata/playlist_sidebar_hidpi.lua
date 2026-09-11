local real_mp = require "mp"
local real_options = require "mp.options"
local real_utils = require "mp.utils"
local sidebar_path = real_mp.get_opt("sidebar-script")

local function near(actual, expected)
    assert(math.abs(actual - expected) < 0.001, string.format("got %s, expected %s", actual, expected))
end

local function harness(scale, width, height, position)
    local state = {
        width = width or 1000 * scale,
        height = height or 600 * scale,
        properties = {
            ["display-hidpi-scale"] = scale,
            ["playlist-pos"] = position or 0,
            ["video-margin-ratio-right"] = 0,
            playlist = {},
        },
        observers = {},
        bindings = {},
        timers = {},
        commands = {},
    }
    for i = 1, 40 do
        state.properties.playlist[i] = {id = i, title = "entry-" .. i}
    end
    local overlay = {}
    function overlay:update()
        self.visible = true
    end
    function overlay:remove()
        self.visible = false
    end
    state.overlay = overlay
    local function property(name, fallback)
        if state.properties[name] == nil then return fallback end
        return state.properties[name]
    end
    package.loaded["mp"] = {
        get_property = property,
        get_property_number = property,
        get_property_native = property,
        set_property_number = function(name, value) state.properties[name] = value end,
        create_osd_overlay = function() return overlay end,
        get_osd_size = function() return state.width, state.height end,
        get_mouse_pos = function() return state.mouse_x, state.mouse_y end,
        set_mouse_area = function(x1, y1, x2, y2) state.area = {x1, y1, x2, y2} end,
        enable_key_bindings = function() state.enabled = true end,
        disable_key_bindings = function() state.enabled = false end,
        set_key_bindings = function(bindings)
            for _, binding in ipairs(bindings) do state.bindings[binding[1]] = binding end
        end,
        observe_property = function(name, _, callback) state.observers[name] = callback end,
        add_timeout = function(_, callback) state.timers[#state.timers + 1] = callback end,
        commandv = function(...) state.commands[#state.commands + 1] = {...} end,
        add_hook = function() end,
        register_event = function() end,
    }
    package.loaded["mp.options"] = {read_options = function() end}
    package.loaded["mp.utils"] = real_utils
    dofile(sidebar_path)
    package.loaded["mp"] = real_mp
    package.loaded["mp.options"] = real_options

    function state:flush()
        while #self.timers > 0 do
            local timers = self.timers
            self.timers = {}
            for _, callback in ipairs(timers) do callback() end
        end
    end
    function state:mouse(x, y)
        self.mouse_x = (x + 0.25) * self.width / self.overlay.res_x
        self.mouse_y = (y + 0.25) * self.height / self.overlay.res_y
    end
    function state:click(x, y)
        self:mouse(x, y)
        self.bindings.mbtn_left[3]()
        self.bindings.mbtn_left[2]()
        self:flush()
    end
    function state:change(name, value)
        self.properties[name] = value
        assert(self.observers[name], "missing observer: " .. name)()
        self:flush()
    end
    state:flush()
    return state
end

local function check_layout(state, logical_width, logical_height, pane_width)
    assert(state.overlay.visible and state.enabled)
    near(state.overlay.res_x, logical_width)
    near(state.overlay.res_y, logical_height)
    local pixel_pane_width = pane_width * state.width / logical_width
    near(state.properties["user-data/javboss/playlist-sidebar-width"], pixel_pane_width)
    near(state.properties["video-margin-ratio-right"], pixel_pane_width / state.width)
    near(state.area[3], state.width)
    near(state.area[4], state.height)
    assert(state.overlay.data:find("\\fs18", 1, true), "logical font size changed")
    assert(state.overlay.data:find("\\pos(" .. (logical_width - pane_width + 52) .. ",75)", 1, true))
end

local function run_tests()
    for _, scale in ipairs({1, 1.25, 1.5, 2}) do
        local state = harness(scale)
        check_layout(state, 1000, 600, 320)
        near(state.area[1], math.floor(675 * scale))
        state:click(900, 58 + 35 + 17)
        assert(state.commands[1][1] == "playlist-play-index")
        assert(state.commands[1][2] == 1, "click selected the wrong row")
        state:click(100, 110)
        assert(#state.commands == 1, "video click selected a playlist row")

        state:mouse(680, 200)
        state.bindings.mouse_move[2]()
        state:flush()
        near(state.area[1], 0)
        state.bindings.mbtn_left[3]()
        state:mouse(600, 200)
        state.bindings.mouse_move[2]()
        state.bindings.mbtn_left[2]()
        state:flush()
        near(state.properties["user-data/javboss/playlist-sidebar-width"], 400 * scale)
        near(state.properties["video-margin-ratio-right"], 0.4)
        assert(#state.commands == 1, "resize played an entry")
        state.bindings.mouse_leave[2]()
        state:flush()
        near(state.area[1], math.floor(595 * scale))
        state.bindings.wheel_down[2]()
        state:flush()
        state:click(900, 75)
        assert(state.commands[2][2] == 3, "scrolled row click is misaligned")

        state:change("fullscreen", true)
        assert(not state.overlay.visible and not state.enabled)
        near(state.properties["user-data/javboss/playlist-sidebar-width"], 0)
        near(state.properties["video-margin-ratio-right"], 0)
    end

    local fractional = harness(1.5, 1501, 901)
    check_layout(fractional, 1001, 601, 320)
    fractional:click(900, 110)
    assert(fractional.commands[1][2] == 1)
    near(fractional.area[1], math.floor(676 * 1501 / 1001))

    check_layout(harness(nil, 1000, 600), 1000, 600, 320)
    for _, scale in ipairs({0, -1, math.huge, 0 / 0}) do
        local state = harness(scale, 1000, 600)
        check_layout(state, 1000, 600, 320)
    end

    local state = harness(1)
    state:mouse(680, 200)
    state.bindings.mbtn_left[3]()
    state:mouse(600, 200)
    state.bindings.mouse_move[2]()
    state:flush()
    state.width, state.height = 2000, 1200
    state:change("display-hidpi-scale", 2)
    check_layout(state, 1000, 600, 400)
    state.bindings.mbtn_left[2]()
    assert(#state.commands == 0, "DPI change retained a stale click")
    state:click(900, 110)
    assert(state.commands[1][2] == 1)
    state.width, state.height = 1000, 600
    state:change("display-hidpi-scale", 1)
    check_layout(state, 1000, 600, 400)

    local current = harness(1, 1000, 1200, 24)
    current:change("display-hidpi-scale", 2)
    assert(current.overlay.data:find("entry-25", 1, true), "DPI change scrolled the current entry out of view")
end

local ok, err = pcall(run_tests)
if ok then
    real_mp.msg.info("SIDEBAR_HIDPI_TESTS_PASSED")
else
    real_mp.msg.error(tostring(err))
end
real_mp.commandv("quit", ok and 0 or 1)
