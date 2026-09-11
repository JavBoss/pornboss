local mp = require "mp"

if mp.get_property("platform") ~= "darwin" then
    return
end

local geometry = mp.get_property("geometry", "")
local size = geometry:match("^(%d+%%?x%d+%%?)[+-]")
if not size then
    return
end

local function release_initial_position(_, dimensions)
    if not dimensions or not dimensions.w or not dimensions.h
        or dimensions.w <= 0 or dimensions.h <= 0 then
        return
    end
    mp.unobserve_property(release_initial_position)
    if mp.get_property("geometry") ~= geometry then
        return
    end
    -- macOS reapplies explicit coordinates on every video reconfiguration,
    -- bypassing auto-window-resize=no. Drop them once the first window exists.
    mp.set_property("geometry", size)
end

mp.observe_property("osd-dimensions", "native", release_initial_position)
