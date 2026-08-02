# Customer photographs

The "Cars we've had in." section on the home page reads its images from this
folder. Nothing in the code needs changing to add them.

## Adding a photo

Name the file after the frame it belongs to and drop it in here:

    01.jpg   02.jpg   03.jpg   04.jpg   05.jpg   06.jpg

Reload the page and it appears. A frame whose file is missing keeps its
placeholder instead — the page never shows a broken image, so it is safe to
add them one at a time.

## Changing the format or adding more

Each frame names its own file in `index.html`:

    <div class="work__frame" data-src="assets/customers/01.jpg">

Change that path to use `.webp` or `.png`. To add a seventh car, copy one
`<figure class="work__item">` block and bump the numbers.

## Sizing

The frames are full-bleed, so these are the largest images on the site.

- Roughly **2000px wide** is plenty; anything larger is wasted bytes.
- Landscape suits the desktop frame (16:9). On phones the frame turns
  upright (4:5) and crops to the centre, so keep the car centred.
- Export as WebP at ~80% quality if you can — typically a third the size of
  the equivalent JPEG.

## Before publishing

The captions in `index.html` (suburb, vehicle, treatment) are placeholder
text. Replace them with the real job, and only publish a customer's car with
their permission.
